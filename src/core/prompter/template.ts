import type { GenerateRequest, Prompter, TemplateConfig } from './types'
import { mulberry32 } from './rng'

/** Slot names in template order, without duplicates. Anything in braces is a slot. */
export function templateSlots(template: string): string[] {
  const out: string[] = []
  for (const m of template.matchAll(/\{([^{}]+)\}/g)) {
    const name = m[1].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

function capitalize(s: string): string {
  return s.replace(/^(\s*)(\p{Ll})/u, (_, sp: string, c: string) => sp + c.toUpperCase())
}

export function renderTemplate(cfg: TemplateConfig, count: number, seed: number): string[] {
  const rng = mulberry32(seed)
  const names = templateSlots(cfg.template)
  const valuesOf = (name: string): string[] =>
    (cfg.slots[name]?.values ?? []).map((v) => v.trim()).filter(Boolean)
  const make = (i: number): string =>
    capitalize(
      cfg.template.replace(/\{([^{}]+)\}/g, (whole, raw: string) => {
        const name = raw.trim()
        if (!names.includes(name)) return whole
        const vals = valuesOf(name)
        if (!vals.length) return ''
        const mode = cfg.slots[name]?.mode ?? 'random'
        if (mode === 'same') return vals[0]
        if (mode === 'order') return vals[i % vals.length]
        return vals[Math.floor(rng() * vals.length)]
      })
    )
  const out: string[] = []
  const seen = new Set<string>()
  const n = Math.max(0, Math.floor(count))
  for (let i = 0; i < n; i++) {
    let p = make(i)
    if (cfg.avoidRepeats) {
      for (let tries = 0; seen.has(p) && tries < 50; tries++) p = make(i)
    }
    seen.add(p)
    out.push(p)
  }
  return out
}

export class TemplatePrompter implements Prompter {
  constructor(private cfg: TemplateConfig) {}
  async generate(req: GenerateRequest): Promise<string[]> {
    return renderTemplate(this.cfg, req.count, req.seed)
  }
}
