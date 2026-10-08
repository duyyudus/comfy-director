import type { SchemaInput } from './types'

export interface SchemaDiff {
  added: SchemaInput[]
  removed: SchemaInput[]
  changed: { before: SchemaInput; after: SchemaInput; what: string[] }[]
  same: SchemaInput[]
}

/** Diff two schemas by input key (keys derive from node titles, not node ids). */
export function diffSchemas(before: SchemaInput[], after: SchemaInput[]): SchemaDiff {
  const old = new Map(before.map((i) => [i.key, i]))
  const neu = new Map(after.map((i) => [i.key, i]))
  const diff: SchemaDiff = { added: [], removed: [], changed: [], same: [] }
  for (const a of after) {
    const b = old.get(a.key)
    if (!b) {
      diff.added.push(a)
      continue
    }
    const what: string[] = []
    if (a.type !== b.type) what.push(`type ${b.type} to ${a.type}`)
    if (a.type === 'file-group' && b.target.kind === 'file-group' && a.target.kind === 'file-group' &&
        a.target.slots.length !== b.target.slots.length) {
      what.push(`${b.target.slots.length} slots now ${a.target.slots.length}`)
    }
    if (a.constraints.maxCount !== b.constraints.maxCount && a.type === 'file-group') {
      what.push(`max ${b.constraints.maxCount ?? '?'} now ${a.constraints.maxCount ?? '?'}`)
    }
    if (JSON.stringify(a.default) !== JSON.stringify(b.default)) what.push(`default ${fmt(b.default)} to ${fmt(a.default)}`)
    if (a.constraints.min !== b.constraints.min || a.constraints.max !== b.constraints.max) what.push('range')
    if (JSON.stringify(a.constraints.options ?? []) !== JSON.stringify(b.constraints.options ?? [])) what.push('options')
    if (!!a.constraints.required !== !!b.constraints.required) what.push(a.constraints.required ? 'now required' : 'now optional')
    if (what.length) diff.changed.push({ before: b, after: a, what })
    else diff.same.push(a)
  }
  for (const b of before) if (!neu.has(b.key)) diff.removed.push(b)
  return diff
}

function fmt(v: unknown): string {
  if (v === '' || v === null || v === undefined) return '(empty)'
  if (Array.isArray(v)) return `${v.length} items`
  const s = String(v)
  return s.length > 24 ? `${s.slice(0, 24)}…` : s
}
