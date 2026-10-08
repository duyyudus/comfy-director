import type { GenerateRequest, LlmConfig, Prompter } from './types'

/** OpenAI-compatible chat completions. Ideas go to this endpoint, never to the ComfyUI server. */
export class LlmPrompter implements Prompter {
  constructor(private cfg: LlmConfig, private fetchImpl: typeof fetch = fetch) {}

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
    const url = `${this.cfg.endpoint.replace(/\/+$/, '')}/chat/completions`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: this.cfg.temperature,
        messages: [
          { role: 'system', content: this.cfg.instruction },
          { role: 'user', content: idea }
        ]
      })
    })
    if (!res.ok) throw new Error(`The endpoint answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = body.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('The endpoint returned no text.')
    return text
  }
}
