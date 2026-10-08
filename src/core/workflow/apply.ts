import type { ApiWorkflow, SchemaInput, Values, WorkflowSchema } from './types'
import { cloneWorkflow, consumersOf, freeNodeId } from './graph'

export interface ApplyOptions {
  seed?: number | null
  /** Maps a stored file value (local hash name) to the name it has on the server. Identity if absent. */
  serverName?: (value: string) => string
}

/**
 * Applies a value map to a copy of the template.
 * - Empty optional file inputs: the LoadImage node and the consumer link are removed.
 * - File groups: extra slots removed, missing slots cloned from the first loader, indices kept contiguous.
 */
export function applyValues(template: ApiWorkflow, schema: WorkflowSchema, values: Values, opts: ApplyOptions = {}): ApiWorkflow {
  const wf = cloneWorkflow(template)
  const toServer = opts.serverName ?? ((v: string) => v)
  const removeIfUnused = (nodeId: string): void => {
    if (wf[nodeId] && consumersOf(wf, nodeId).length === 0) delete wf[nodeId]
  }

  for (const input of schema.inputs) {
    const raw = input.key in values ? values[input.key] : input.default
    const t = input.target
    if (t.kind === 'field') {
      if (!wf[t.nodeId]) continue
      wf[t.nodeId].inputs[t.field] = coerce(input, raw)
    } else if (t.kind === 'file') {
      const name = typeof raw === 'string' && raw ? raw : null
      if (name) {
        if (wf[t.nodeId]) wf[t.nodeId].inputs[t.field] = toServer(name)
      } else {
        delete wf[t.consumerId]?.inputs[t.consumerInput]
        removeIfUnused(t.nodeId)
      }
    } else {
      const files = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && !!v) : []
      const consumer = wf[t.consumerId]
      if (!consumer) continue
      const template0 = t.slots[0] ? template[t.slots[0].nodeId] : undefined
      for (const s of t.slots) delete consumer.inputs[s.input]
      const taken = new Set<string>()
      files.forEach((file, i) => {
        let nodeId = t.slots[i]?.nodeId
        if (!nodeId || !wf[nodeId]) {
          if (!template0) return
          nodeId = freeNodeId(wf, taken)
          taken.add(nodeId)
          wf[nodeId] = JSON.parse(JSON.stringify(template0))
        }
        wf[nodeId].inputs.image = toServer(file)
        consumer.inputs[`${t.prefix}.${t.base}${i}`] = [nodeId, 0]
      })
      for (const s of t.slots) removeIfUnused(s.nodeId)
    }
  }

  if (opts.seed !== undefined && opts.seed !== null) {
    for (const s of schema.seedTargets) if (wf[s.nodeId]) wf[s.nodeId].inputs[s.field] = opts.seed
  }
  return wf
}

function coerce(input: SchemaInput, v: unknown): unknown {
  switch (input.type) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) return input.default
      return input.constraints.integer ? Math.round(n) : n
    }
    case 'toggle':
      return v === true || v === 'true' || v === 1
    case 'text':
    case 'select':
      return v === null || v === undefined ? '' : String(v)
    default:
      return v
  }
}

/** Every file value referenced by a value map (for upload). */
export function fileValues(schema: WorkflowSchema, values: Values): string[] {
  const out = new Set<string>()
  for (const i of schema.inputs) {
    const v = values[i.key]
    if (i.type === 'file' && typeof v === 'string' && v) out.add(v)
    if (i.type === 'file-group' && Array.isArray(v)) for (const f of v) if (typeof f === 'string' && f) out.add(f)
  }
  return [...out]
}
