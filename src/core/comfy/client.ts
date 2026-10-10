import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { ApiWorkflow } from '../workflow/types'
import type { ObjectInfo } from '../workflow/objectInfo'
import type { ServerDeleteResult, ServerFile, ServerFileRef, ServerFolder } from './files'

/** ComfyUI HTTP + WebSocket client. Plain TypeScript; usable outside Electron. */

export interface ComfyClientOptions {
  baseUrl: string
  token?: string | null
  clientId: string
  fetchImpl?: typeof fetch
}

export class ComfyError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message)
  }
  get unauthorized(): boolean {
    return this.status === 401 || this.status === 403
  }
  /** A route the server does not have: how a missing companion node shows up. */
  get notInstalled(): boolean {
    return this.status === 404 || this.status === 405
  }
}

/** Element of `queue_running` / `queue_pending`: [number, prompt_id, prompt, extra_data, outputs]. */
export type QueueEntry = [number, string, ApiWorkflow, { client_id?: string; [k: string]: unknown }, string[]]

export interface QueueState {
  queue_running: QueueEntry[]
  queue_pending: QueueEntry[]
}

export interface NodeError {
  errors: { type: string; message: string; details?: string; extra_info?: { input_name?: string } }[]
  class_type: string
  dependent_outputs?: string[]
}

export interface PromptRejection {
  error: { type?: string; message?: string; details?: string }
  node_errors: Record<string, NodeError>
}

export interface OutputFileRef {
  filename: string
  subfolder: string
  type: string
}

export interface HistoryEntry {
  prompt: unknown[]
  outputs: Record<string, Record<string, unknown>>
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] }
}

/** Execution time in ms as the server recorded it (execution_start to execution_success), or null if the history lacks it. */
export function historyRenderMs(entry: HistoryEntry): number | null {
  const msgs = entry.status?.messages ?? []
  const at = (type: string): number | null => {
    const v = msgs.find(([t]) => t === type)?.[1]?.timestamp
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  const start = at('execution_start')
  const end = at('execution_success')
  return start !== null && end !== null && end >= start ? Math.round(end - start) : null
}

export type WsMessage ={ type: string; data: Record<string, unknown> }

export class ComfyClient extends EventEmitter {
  readonly baseUrl: string
  private token: string | null
  readonly clientId: string
  private fetchImpl: typeof fetch
  private ws: WebSocket | null = null

  constructor(opts: ComfyClientOptions) {
    super()
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.token = opts.token || null
    this.clientId = opts.clientId
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}`, ...extra } : extra
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        ...init,
        headers: { ...this.headers(), ...((init.headers as Record<string, string>) ?? {}) },
        signal: ctrl.signal
      })
      return res
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? 'The server did not answer in time.' : (e as Error).message
      throw new ComfyError(`Can't reach the server: ${msg}`, 0)
    } finally {
      clearTimeout(timer)
    }
  }

  private async json<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
    const res = await this.request(path, init, timeoutMs)
    const text = await res.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const msg = res.status === 401 || res.status === 403 ? 'The server refused the access token.' : `Server answered ${res.status}.`
      throw new ComfyError(msg, res.status, body)
    }
    return body as T
  }

  objectInfo(): Promise<ObjectInfo> {
    return this.json<ObjectInfo>('/object_info', undefined, 60_000)
  }

  /** Queues a prompt. Throws ComfyError with a PromptRejection body when the server rejects it. */
  async queuePrompt(prompt: ApiWorkflow, extra: Record<string, unknown> = {}): Promise<{ prompt_id: string; number: number }> {
    return this.json('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: this.clientId, extra_data: { client_id: this.clientId, ...extra } })
    })
  }

  getQueue(): Promise<QueueState> {
    return this.json<QueueState>('/queue')
  }

  async getHistory(promptId: string): Promise<HistoryEntry | null> {
    const h = await this.json<Record<string, HistoryEntry>>(`/history/${encodeURIComponent(promptId)}`)
    return h?.[promptId] ?? null
  }

  async view(file: OutputFileRef): Promise<ArrayBuffer> {
    const res = await this.viewResponse(file)
    if (!res.ok) throw new ComfyError(`Download of ${file.filename} failed (${res.status}).`, res.status)
    return res.arrayBuffer()
  }

  /** The raw `/view` response, for streaming a file. `range` is passed on as the Range header. */
  viewResponse(file: OutputFileRef, range?: string | null): Promise<Response> {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' })
    return this.request(`/view?${q}`, range ? { headers: { Range: range } } : {}, 10 * 60_000)
  }

  /** Files in one of the server's folders. Needs the companion node: without it the error has `notInstalled` set. */
  async listFiles(type: ServerFolder): Promise<ServerFile[]> {
    const r = await this.json<{ files?: { filename: string; subfolder?: string; size: number; modified: number }[] }>(
      `/comfy_director/files?type=${type}`, undefined, 60_000
    )
    if (!Array.isArray(r?.files)) throw new ComfyError('The server did not answer with a file list.', 404, r)
    return r.files.map((f) => ({ filename: f.filename, subfolder: f.subfolder ?? '', type, size: f.size, modified: Math.round(f.modified * 1000) }))
  }

  /** A small JPEG of an image or of a video's first frame (companion node). 404 when the file has no picture. */
  thumbResponse(file: ServerFileRef, size: number): Promise<Response> {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type, size: String(size) })
    return this.request(`/comfy_director/thumb?${q}`, {}, 60_000)
  }

  /** Deletes files from the server's input, output and temp folders (companion node). */
  async deleteFiles(files: ServerFileRef[]): Promise<ServerDeleteResult> {
    const r = await this.json<Partial<ServerDeleteResult>>('/comfy_director/files/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: files.map((f) => ({ filename: f.filename, subfolder: f.subfolder, type: f.type })) })
    }, 5 * 60_000)
    return { deleted: r?.deleted ?? [], errors: r?.errors ?? [] }
  }

  async uploadImage(name: string, data: Uint8Array, mime = 'application/octet-stream'): Promise<{ name: string; subfolder: string; type: string }> {
    const form = new FormData()
    form.append('image', new Blob([data as BlobPart], { type: mime }), name)
    form.append('type', 'input')
    form.append('overwrite', 'true')
    return this.json('/upload/image', { method: 'POST', body: form }, 5 * 60_000)
  }

  /** Removes waiting jobs by id. Never a clear-all. */
  async deleteQueued(promptIds: string[]): Promise<void> {
    if (!promptIds.length) return
    await this.json('/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: promptIds })
    })
  }

  /** Stops the running job. With a prompt id, servers that support it only stop that job. */
  async interrupt(promptId?: string): Promise<void> {
    await this.json('/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(promptId ? { prompt_id: promptId } : {})
    })
  }

  connect(): void {
    this.disconnect()
    const url = this.baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${encodeURIComponent(this.clientId)}`
    const ws = new WebSocket(url, { headers: this.headers() })
    this.ws = ws
    ws.on('open', () => this.emit('open'))
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return // preview images
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage
        this.emit('message', msg)
      } catch {
        /* ignore */
      }
    })
    ws.on('unexpected-response', (_req, res) => {
      this.emit('ws-error', new ComfyError(`WebSocket refused (${res.statusCode}).`, res.statusCode ?? 0))
    })
    ws.on('error', (e) => this.emit('ws-error', e))
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null
      this.emit('close')
    })
  }

  disconnect(): void {
    if (this.ws) {
      const ws = this.ws
      this.ws = null
      ws.removeAllListeners('close')
      ws.on('error', () => {})
      ws.terminate()
    }
  }

  get wsOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export function normalizeBaseUrl(url: string): string {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  return u.replace(/\/+$/, '')
}

export function serverName(url: string): string {
  try {
    return new URL(normalizeBaseUrl(url)).hostname || url
  } catch {
    return url
  }
}

/** All file references in a history entry's outputs (images, gifs, videos, audio...). */
export function historyFiles(entry: HistoryEntry): (OutputFileRef & { nodeId: string })[] {
  const out: (OutputFileRef & { nodeId: string })[] = []
  const seen = new Set<string>()
  for (const [nodeId, outputs] of Object.entries(entry.outputs ?? {})) {
    for (const list of Object.values(outputs)) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (item && typeof item === 'object' && typeof (item as OutputFileRef).filename === 'string') {
          const f = item as OutputFileRef
          if (f.type && f.type !== 'output') continue
          const id = `${f.subfolder}/${f.filename}`
          if (seen.has(id)) continue
          seen.add(id)
          out.push({ nodeId, filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' })
        }
      }
    }
  }
  return out
}

/** Readable reason from an execution_error payload. */
export function describeExecutionError(d: Record<string, unknown>): { message: string; nodeId?: string; nodeType?: string; errorType?: string; details: string } {
  const exType = String(d.exception_type ?? '')
  const exMsg = String(d.exception_message ?? '').trim()
  let message = exMsg || 'The server reported an error.'
  if (/OutOfMemory|out of memory/i.test(exType + exMsg)) message = 'Out of GPU memory while running. Try fewer megapixels, a shorter duration, or turbo.'
  const tb = Array.isArray(d.traceback) ? (d.traceback as string[]).join('') : ''
  return {
    message,
    nodeId: d.node_id !== undefined ? String(d.node_id) : undefined,
    nodeType: d.node_type !== undefined ? String(d.node_type) : undefined,
    errorType: exType || undefined,
    details: [exType && `${exType}: ${exMsg}`, tb].filter(Boolean).join('\n')
  }
}
