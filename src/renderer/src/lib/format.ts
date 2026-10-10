import type { Attempt } from '@shared/types'
import type { SchemaInput } from '@core/workflow/types'
import { fileNoun } from '@core/workflow/validate'

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

/**
 * How long an attempt took to render ('' when unknown). A finished attempt uses the figure from the server;
 * a running one counts up from when the app saw it start, given the current time `nowMs`.
 */
export function renderTime(a: Pick<Attempt, 'startedAt' | 'finishedAt' | 'renderMs'>, nowMs?: number): string {
  // Attempts finished before render_ms existed fall back to the app's own stamps.
  const end = a.finishedAt ? Date.parse(a.finishedAt) : nowMs
  const ms = a.renderMs ?? (end !== undefined && a.startedAt ? end - Date.parse(a.startedAt) : null)
  if (ms === null) return ''
  const s = Math.round(ms / 1000)
  if (!Number.isFinite(s) || s < 0) return ''
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
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

export function megapixelsOf(values: Record<string, unknown>): number | null {
  const v = values.megapixels
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

export function durationOf(values: Record<string, unknown>): number | null {
  const v = values.duration
  return typeof v === 'number' ? v : typeof v === 'string' && v && !Number.isNaN(Number(v)) ? Number(v) : null
}

/** The full seed, for places with room for it (the shortened form is `seedTail`). */
export function attemptSeed(a: Attempt): string {
  return `seed ${a.seed}`
}

/** One-line summary: "turbo · 8 steps · 15 s · 0.4 MP · seed …4924". */
export function attemptSummary(a: Attempt, withSeed = true): string {
  const parts: string[] = []
  const t = turboOf(a.values)
  if (t !== null) parts.push(t ? 'turbo' : 'full')
  if (a.steps !== null) parts.push(`${a.steps} steps`)
  const d = durationOf(a.values)
  if (d !== null) parts.push(`${d} s`)
  const mp = megapixelsOf(a.values)
  if (mp !== null) parts.push(`${mp} MP`)
  if (withSeed) parts.push(`seed ${seedTail(a.seed)}`)
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
    return `${v.length} ${fileNoun(input, v.length)}`
  }
  if (input?.type === 'file') return inputNames?.[String(v)] ?? String(v)
  const s = String(v)
  return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}

/** File size: "812 KB", "1.4 GB". */
export function bytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
