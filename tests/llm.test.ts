import { describe, expect, it } from 'vitest'
import { LlmPrompter, promptFromReply, splitReply, systemPrompt } from '../src/core/prompter/llm'
import { DEFAULT_LLM } from '../src/core/prompter/types'

const cfg = { ...DEFAULT_LLM, instruction: 'Keep it under 80 words.' }

/** A fetch that records the request body and answers with `reply`. */
function fakeFetch(reply: string): { fetch: typeof fetch; bodies: { messages: { role: string; content: unknown }[] }[] } {
  const bodies: { messages: { role: string; content: unknown }[] }[] = []
  const f = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetch: f, bodies }
}

describe('llm system prompt', () => {
  it('is the instruction alone without a skill', () => {
    expect(systemPrompt(cfg, null, 'list')).toBe('Keep it under 80 words.')
  })
  it('puts the whole skill before the instruction', () => {
    const skill = '# Guide\n\nline one\n\n## Last section\nthe very end'
    const s = systemPrompt(cfg, skill, 'list')
    expect(s).toContain(skill)
    expect(s.indexOf('the very end')).toBeLessThan(s.indexOf('Keep it under 80 words.'))
    expect(s).toMatch(/prompt only/)
  })
  it('asks for fenced prompts in chat', () => {
    expect(systemPrompt(cfg, null, 'chat')).toMatch(/fenced code block/)
    expect(systemPrompt({ ...cfg, instruction: '' }, 'guide', 'chat')).not.toMatch(/\n\n\n/)
  })
})

describe('reply parsing', () => {
  it('splits prose and prompt blocks', () => {
    const parts = splitReply('Here it is:\n\n```text\nA woman walks.\nShe stops.\n```\n\nWhy: one camera idea.\n\n```\nSecond option.\n```')
    expect(parts).toEqual([
      { type: 'text', text: 'Here it is:' },
      { type: 'prompt', text: 'A woman walks.\nShe stops.' },
      { type: 'text', text: 'Why: one camera idea.' },
      { type: 'prompt', text: 'Second option.' }
    ])
  })
  it('keeps markdown headings inside a block and an unclosed last block', () => {
    expect(splitReply('```\n### summary:\nx\n')).toEqual([{ type: 'prompt', text: '### summary:\nx' }])
  })
  it('takes the first block as the prompt, or the whole reply', () => {
    expect(promptFromReply('Sure!\n```\nthe prompt\n```\nnotes')).toBe('the prompt')
    expect(promptFromReply('  just the prompt \n')).toBe('just the prompt')
  })
})

describe('llm prompter requests', () => {
  it('sends the skill as the system message and unwraps the reply', async () => {
    const { fetch, bodies } = fakeFetch('```\nfinal prompt\n```')
    const out = await new LlmPrompter(cfg, 'SKILL TEXT', fetch).generate({ count: 1, seed: 0, currentPrompt: '', ideas: ['a roof at dusk'] })
    expect(out).toEqual(['final prompt'])
    expect(bodies[0].messages[0].role).toBe('system')
    expect(bodies[0].messages[0].content).toContain('SKILL TEXT')
    expect(bodies[0].messages[1]).toEqual({ role: 'user', content: 'a roof at dusk' })
  })
  it('streams a chat reply piece by piece', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Try "}}]}\n\ndata: {"choi',
      'ces":[{"delta":{"content":"this"}}]}\r\n\r\n: keep-alive\n\n',
      'data: [DONE]\n\n'
    ]
    let body: { stream?: boolean } = {}
    const fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init?.body))
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (const s of chunks) c.enqueue(new TextEncoder().encode(s))
          c.close()
        }
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } })
    }) as unknown as typeof globalThis.fetch
    const seen: string[] = []
    const reply = await new LlmPrompter(cfg, null, fetch).chat([{ role: 'user', content: 'hi' }], { onDelta: (t) => seen.push(t) })
    expect(body.stream).toBe(true)
    expect(seen).toEqual(['Try ', 'this'])
    expect(reply).toBe('Try this')
  })
  it('returns what arrived when a streamed reply is stopped', async () => {
    const abort = new AbortController()
    const fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"half"}}]}\n\n'))
          abort.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
        }
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as unknown as typeof globalThis.fetch
    const reply = await new LlmPrompter(cfg, null, fetch).chat([{ role: 'user', content: 'hi' }], { signal: abort.signal, onDelta: () => abort.abort() })
    expect(reply).toBe('half')
  })
  it('passes a one-piece answer to onDelta when the endpoint does not stream', async () => {
    const { fetch } = fakeFetch('whole')
    const seen: string[] = []
    expect(await new LlmPrompter(cfg, null, fetch).chat([{ role: 'user', content: 'hi' }], { onDelta: (t) => seen.push(t) })).toBe('whole')
    expect(seen).toEqual(['whole'])
  })
  it('sends the whole conversation with images in chat and returns the reply whole', async () => {
    const { fetch, bodies } = fakeFetch('Try this:\n```\np\n```')
    const turns = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'Image 1:' }, { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'text' as const, text: 'a shot' }] },
      { role: 'assistant' as const, content: 'first try' },
      { role: 'user' as const, content: 'slower camera' }
    ]
    const reply = await new LlmPrompter(cfg, null, fetch).chat(turns)
    expect(reply).toBe('Try this:\n```\np\n```')
    expect(bodies[0].messages.slice(1)).toEqual(turns)
  })
})
