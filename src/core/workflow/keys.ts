/** Input key derivation (PRD: Workflow Handling > Input keys). */

export function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Text inside the last parentheses of a title, or the whole title, with its original case. */
export function titleInner(title: string): string {
  const m = title.match(/\(([^()]*)\)\s*$/)
  return (m ? m[1] : title).trim()
}

/** `Float (Duration)` -> `duration`; `Boolean (Enable Lightning LoRA)` -> `enable lightning lora`. */
export function keyFromTitle(title: string): string {
  return normalize(titleInner(title))
}

/** `ref_images` -> `Ref images`, `aspect_ratio` -> `Aspect ratio`. */
export function humanize(name: string): string {
  const s = name.replace(/[._]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Fields that are seeds and are driven by the Seed control. */
export const SEED_FIELDS = new Set(['seed', 'noise_seed'])
