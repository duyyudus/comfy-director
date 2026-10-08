import type { Attempt } from '@shared/types'
import type { SchemaInput } from '@core/workflow/types'

export function timeAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function seedTail(seed: number | null | undefined): string {
  if (seed === null || seed === undefined) return '—'
  return `…${String(seed).slice(-4)}`
}

export function pad2(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n).padStart(2, '0')
}

export function secs(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  const r = Math.round(n * 10) / 10
  return `${r} s`
}

export function clock(t: number): string {
  if (!Number.isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Turbo/full flag from a value map, if the workflow has such a toggle. */
export function turboOf(values: Record<string, unknown>): boolean | null {
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'boolean' && /turbo|lightning|fast/i.test(k)) return v
  }
  return null
}

export function durationOf(values: Record<string, unknown>): number | null {
  const v = values.duration
  return typeof v === 'number' ? v : typeof v === 'string' && v && !Number.isNaN(Number(v)) ? Number(v) : null
}

/** One-line summary: "turbo · 15 s · seed …4924". */
export function attemptSummary(a: Attempt): string {
  const parts: string[] = []
  const t = turboOf(a.values)
  if (t !== null) parts.push(t ? 'turbo' : 'full')
  const d = durationOf(a.values)
  if (d !== null) parts.push(`${d} s`)
  parts.push(`seed ${seedTail(a.seed)}`)
  return parts.join(' · ')
}

export function formatValue(input: SchemaInput | undefined, v: unknown, inputNames?: Record<string, string>): string {
  if (v === undefined || v === null || v === '') return input?.type === 'file' ? 'None' : '(empty)'
  if (typeof v === 'boolean') {
    if (input && /turbo|lightning/i.test(input.key + input.label)) return v ? 'On' : 'Off (full)'
    return v ? 'On' : 'Off'
  }
  if (Array.isArray(v)) {
    if (!v.length) return 'None'
    return `${v.length} image${v.length === 1 ? '' : 's'}`
  }
  if (input?.type === 'file') return inputNames?.[String(v)] ?? String(v)
  const s = String(v)
  return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}
