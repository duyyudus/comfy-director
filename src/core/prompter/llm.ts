import type { GenerateRequest, LlmConfig, Prompter } from './types'

export type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string | ChatPart[]
}

const LIST_RULE = 'Reply with the finished prompt only: no explanation, no preamble, no alternatives.'

const CHAT_RULE = [
  'You are helping the user write and revise the prompt for one shot. They will describe the shot, may attach reference',
  'images (each is announced as "Image N" just before it, in the order they were attached), render the prompt, and come',
  'back with what to change.',
  'Put every prompt you propose in its own fenced code block (```), with nothing but the prompt inside, so the app can',
  'copy it out. Keep explanations outside the block and short. Ask a question instead of guessing when something that',
  'matters is missing.'
].join('\n')

/**
 * The system message: the whole skill first, then the prompter's own instruction, then how to answer.
 * A prompter without a skill in list mode gets its instruction unchanged.
 */
export function systemPrompt(cfg: LlmConfig, skill: string | null, mode: 'list' | 'chat'): string {
  const parts: string[] = []
  if (skill?.trim()) parts.push(`Follow this prompting guide.\n\n<prompting_guide>\n${skill.trim()}\n</prompting_guide>`)
  if (cfg.instruction.trim()) parts.push(cfg.instruction.trim())
  if (mode === 'chat') parts.push(CHAT_RULE)
  else if (skill?.trim()) parts.push(LIST_RULE)
  return parts.join('\n\n')
}

export interface ReplyPart {
  type: 'text' | 'prompt'
  text: string
}

/** Splits a reply into prose and the fenced blocks that hold prompts. An unclosed last fence still counts. */
export function splitReply(reply: string): ReplyPart[] {
  const parts: ReplyPart[] = []
  let text: string[] = []
  let block: string[] | null = null
  let fence = ''
  const flushText = (): void => {
    const t = text.join('\n').trim()
    if (t) parts.push({ type: 'text', text: t })
    text = []
  }
  for (const line of reply.split(/\r?\n/)) {
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (block === null && m) {
      flushText()
      block = []
      fence = m[1]
    } else if (block !== null && m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
      if (block.join('\n').trim()) parts.push({ type: 'prompt', text: block.join('\n').trim() })
      block = null
    } else (block ?? text).push(line)
  }
  if (block !== null && block.join('\n').trim()) parts.push({ type: 'prompt', text: block.join('\n').trim() })
  flushText()
  return parts
}

/** The prompt in a reply: its first fenced block, or the whole text when it has none. */
export function promptFromReply(reply: string): string {
  return splitReply(reply).find((p) => p.type === 'prompt')?.text ?? reply.trim()
}

export interface ChatOptions {
  /** Called with each piece of the reply as it arrives. Setting it asks the endpoint to stream. */
  onDelta?: (text: string) => void
  /** Stops the request. What has arrived by then is returned as the reply. */
  signal?: AbortSignal
}

/** Reads a `text/event-stream` chat completion, passing on each content delta. Returns the whole text. */
async function readStream(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const take = (line: string): void => {
    const m = line.match(/^data:\s?(.*)$/)
    if (!m || m[1].trim() === '[DONE]') return
    let delta: unknown
    try {
      delta = (JSON.parse(m[1]) as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content
    } catch {
      return // a keep-alive or a partial line some servers send
    }
    if (typeof delta === 'string' && delta) {
      text += delta
      onDelta(delta)
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(take)
    }
    take(buffer)
  } catch (e) {
    if (!signal?.aborted) throw e
  }
  return text
}

/** OpenAI-compatible chat completions. Ideas go to this endpoint, never to the ComfyUI server. */
export class LlmPrompter implements Prompter {
  constructor(private cfg: LlmConfig, private skill: string | null = null, private fetchImpl: typeof fetch = fetch) {}

  async generate(req: GenerateRequest): Promise<string[]> {
    const ideas =
      this.cfg.inputMode === 'shot-prompt'
        ? Array.from({ length: Math.max(1, req.count) }, () => req.currentPrompt)
        : (req.ideas ?? []).map((s) => s.trim()).filter(Boolean)
    if (!ideas.length) throw new Error('No ideas to expand. Paste one idea per line.')
    const out: string[] = []
    for (const idea of ideas) out.push(await this.complete(idea))
    return out
  }

  async complete(idea: string): Promise<string> {
    return promptFromReply(await this.send(systemPrompt(this.cfg, this.skill, 'list'), [{ role: 'user', content: idea }]))
  }

  /** One reply to a conversation. The reply is returned whole, prose and prompt blocks. */
  async chat(turns: ChatTurn[], opts: ChatOptions = {}): Promise<string> {
    return this.send(systemPrompt(this.cfg, this.skill, 'chat'), turns, opts)
  }

  private async send(system: string, turns: ChatTurn[], opts: ChatOptions = {}): Promise<string> {
    const url = `${this.cfg.endpoint.replace(/\/+$/, '')}/chat/completions`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      signal: opts.signal,
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: this.cfg.temperature,
        messages: [{ role: 'system', content: system }, ...turns],
        ...(opts.onDelta && { stream: true })
      })
    })
    if (!res.ok) throw new Error(`The endpoint answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    // An endpoint that ignores `stream` answers with plain JSON, handled below.
    if (opts.onDelta && res.body && (res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const streamed = (await readStream(res.body, opts.onDelta, opts.signal)).trim()
      if (!streamed && !opts.signal?.aborted) throw new Error('The endpoint returned no text.')
      return streamed
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = body.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('The endpoint returned no text.')
    opts.onDelta?.(text)
    return text
  }
}
