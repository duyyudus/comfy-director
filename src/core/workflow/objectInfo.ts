/** Helpers for reading `GET /object_info`. Handles the old (`[[opts], {}]`) and new (`["COMBO", {options}]`) shapes. */

export type ObjectInfo = Record<string, NodeInfo>
export interface NodeInfo {
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown>; hidden?: Record<string, unknown> }
  output?: unknown[]
  display_name?: string
  category?: string
}

export interface InputSpec {
  type: string
  options?: string[]
  min?: number
  max?: number
  step?: number
  multiline?: boolean
  tooltip?: string
  optional: boolean
  raw: Record<string, unknown>
}

export function inputSpec(oi: ObjectInfo | null | undefined, classType: string, name: string): InputSpec | null {
  const node = oi?.[classType]
  if (!node?.input) return null
  const base = name.includes('.') ? name.slice(0, name.indexOf('.')) : name
  for (const section of ['required', 'optional'] as const) {
    const entry = node.input[section]?.[name] ?? node.input[section]?.[base]
    if (entry !== undefined) return parseSpec(entry, section === 'optional')
  }
  return null
}

function parseSpec(entry: unknown, optional: boolean): InputSpec {
  const arr = Array.isArray(entry) ? entry : [entry]
  const head = arr[0]
  const opts = (arr[1] && typeof arr[1] === 'object' ? arr[1] : {}) as Record<string, unknown>
  let type = 'UNKNOWN'
  let options: string[] | undefined
  if (Array.isArray(head)) {
    type = 'COMBO'
    options = head.map(String)
  } else if (typeof head === 'string') {
    type = head
    if (head === 'COMBO' && Array.isArray(opts.options)) options = (opts.options as unknown[]).map(String)
  }
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  return {
    type,
    options,
    min: num(opts.min),
    max: num(opts.max),
    step: num(opts.step),
    multiline: opts.multiline === true,
    tooltip: typeof opts.tooltip === 'string' ? opts.tooltip : undefined,
    optional,
    raw: opts
  }
}

/**
 * Slot count bounds for a dynamic input group (e.g. `ref_images`), searched in the spec options:
 * numeric `min`/`max` anywhere in the options, or a `names` list whose length is the max.
 */
export function groupBounds(spec: InputSpec | null): { min?: number; max?: number } {
  if (!spec) return {}
  let min: number | undefined
  let max: number | undefined
  const visit = (o: unknown, depth: number): void => {
    if (!o || typeof o !== 'object' || depth > 4) return
    const rec = o as Record<string, unknown>
    if (min === undefined && typeof rec.min === 'number') min = rec.min
    if (max === undefined && typeof rec.max === 'number') max = rec.max
    if (max === undefined && Array.isArray(rec.names)) max = rec.names.length
    for (const v of Object.values(rec)) if (v && typeof v === 'object') visit(v, depth + 1)
  }
  visit(spec.raw, 0)
  return { min, max }
}

export function nodeTypeCount(oi: ObjectInfo | null | undefined): number {
  return oi ? Object.keys(oi).length : 0
}
