import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { ComfyClient, ComfyError, serverName, normalizeBaseUrl, type WsMessage } from '@core/comfy/client'
import type { ObjectInfo } from '@core/workflow/objectInfo'
import type { ServerStatus, TestResult } from '@shared/types'

const oiFile = (): string => join(app.getPath('userData'), 'object_info.json')

/**
 * Keeps one connection to the ComfyUI server: object_info (cached on disk so the
 * schema works offline), the WebSocket, and the retry loop while offline.
 */
export class ServerManager extends EventEmitter {
  client: ComfyClient | null = null
  objectInfo: ObjectInfo | null = null
  status: ServerStatus = { state: 'unconfigured', serverName: '', serverUrl: '' }
  private retryTimer: NodeJS.Timeout | null = null
  private attempt = 0
  private url = ''
  private token: string | null = null
  private clientId = ''

  constructor() {
    super()
    try {
      this.objectInfo = JSON.parse(readFileSync(oiFile(), 'utf8'))
    } catch {
      /* none cached */
    }
  }

  get connected(): boolean {
    return this.status.state === 'connected' && !!this.client
  }

  get url_(): string {
    return this.url
  }

  configure(url: string, token: string | null, clientId: string): void {
    this.url = url ? normalizeBaseUrl(url) : ''
    this.token = token
    this.clientId = clientId
    this.stop()
    if (!this.url) {
      this.setStatus({ state: 'unconfigured', serverName: '', serverUrl: '' })
      return
    }
    this.client = new ComfyClient({ baseUrl: this.url, token, clientId })
    this.client.on('message', (m: WsMessage) => this.emit('message', m))
    this.client.on('close', () => this.lost('The connection to the server was lost.'))
    this.client.on('ws-error', (e: Error) => {
      if (this.status.state !== 'connected') this.lost(e instanceof ComfyError && e.unauthorized ? e.message : `WebSocket: ${e.message}`, e instanceof ComfyError && e.unauthorized)
    })
    this.client.on('open', () => {
      this.attempt = 0
      this.setStatus({
        state: 'connected',
        serverName: serverName(this.url),
        serverUrl: this.url,
        nodeTypeCount: this.objectInfo ? Object.keys(this.objectInfo).length : undefined
      })
      this.emit('connected')
    })
    void this.connect()
  }

  private stop(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.client) {
      this.client.removeAllListeners()
      this.client.disconnect()
    }
    this.client = null
  }

  private async connect(): Promise<void> {
    const client = this.client
    if (!client) return
    this.setStatus({ ...this.status, state: 'connecting', serverName: serverName(this.url), serverUrl: this.url, retryAt: undefined })
    try {
      const oi = await client.objectInfo()
      if (client !== this.client) return
      this.objectInfo = oi
      try {
        writeFileSync(oiFile(), JSON.stringify(oi))
      } catch {
        /* cache only */
      }
      this.emit('object-info')
      client.connect()
    } catch (e) {
      if (client !== this.client) return
      const unauthorized = e instanceof ComfyError && e.unauthorized
      this.lost((e as Error).message, unauthorized)
    }
  }

  private lost(message: string, unauthorized = false): void {
    if (!this.client) return
    const wasConnected = this.status.state === 'connected'
    if (this.retryTimer) return
    const delay = Math.min(30, 2 ** Math.min(this.attempt, 4) * 2) * (unauthorized ? 2 : 1)
    this.attempt++
    this.setStatus({
      state: unauthorized ? 'unauthorized' : 'offline',
      serverName: serverName(this.url),
      serverUrl: this.url,
      message: unauthorized ? 'The server refused the access token. Check it in Server settings.' : message,
      retryAt: Date.now() + delay * 1000
    })
    if (wasConnected) this.emit('disconnected')
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.client?.disconnect()
      void this.connect()
    }, delay * 1000)
  }

  retryNow(): void {
    if (!this.client) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.client.disconnect()
    void this.connect()
  }

  private setStatus(s: ServerStatus): void {
    this.status = s
    this.emit('status', s)
  }

  static async test(url: string, token: string | null): Promise<TestResult> {
    if (!url.trim()) return { ok: false, message: 'Enter the server address.' }
    const c = new ComfyClient({ baseUrl: url, token, clientId: 'test' })
    try {
      const oi = await c.objectInfo()
      const n = Object.keys(oi).length
      return { ok: true, message: `Connected. ${n} node types found.`, nodeTypeCount: n }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
}
