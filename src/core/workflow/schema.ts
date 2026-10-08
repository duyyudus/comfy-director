import type { ApiWorkflow, InputType, Overrides, SchemaInput, WorkflowSchema } from './types'
import { discover, fieldCandidate, type Discovery } from './discover'
import { normalize } from './keys'
import { isLink, titleOf } from './graph'
import type { ObjectInfo } from './objectInfo'

const TYPE_RANK: Record<InputType, number> = { text: 0, number: 1, select: 1, toggle: 2, file: 3, 'file-group': 4 }

export interface SchemaResult extends WorkflowSchema {
  discovery: Discovery
  /** Override entries that no longer match anything in the workflow. */
  warnings: string[]
}

/** Derives the input schema from the workflow, its overrides, and (when available) the server's object_info. */
export function buildSchema(wf: ApiWorkflow, overrides: Overrides | null | undefined, oi?: ObjectInfo | null): SchemaResult {
  const discovery = discover(wf, oi)
  const warnings: string[] = []
  const inputs: (SchemaInput & { rank: number })[] = []
  let idx = 0

  for (const c of discovery.candidates) {
    const ov = overrides?.inputs?.[c.id]
    const exposed = ov?.hidden !== undefined ? !ov.hidden : c.defaultExposed
    idx++
    if (!exposed) continue
    inputs.push({
      key: ov?.key?.trim() || c.key,
      type: c.type,
      label: ov?.label?.trim() || c.label,
      help: ov?.help,
      default: c.default,
      constraints: {
        ...c.constraints,
        ...(ov?.min !== undefined && { min: ov.min }),
        ...(ov?.max !== undefined && { max: ov.max }),
        ...(ov?.step !== undefined && { step: ov.step }),
        ...(ov?.minCount !== undefined && { minCount: ov.minCount }),
        ...(ov?.maxCount !== undefined && { maxCount: ov.maxCount })
      },
      target: c.target,
      source: c.source,
      order: ov?.order ?? 1000 + idx,
      rank: TYPE_RANK[c.type]
    })
  }

  for (const e of overrides?.expose ?? []) {
    idx++
    const nodeId = Object.keys(wf).find(
      (id) => wf[id].class_type === e.class && (!e.title || normalize(titleOf(wf[id])) === normalize(e.title))
    )
    if (!nodeId) {
      warnings.push(`Exposed field ${e.class}.${e.field} not found in the workflow.`)
      continue
    }
    const v = wf[nodeId].inputs[e.field]
    if (v === undefined || isLink(v)) {
      warnings.push(`Field ${e.field} on ${titleOf(wf[nodeId])} is not a plain value.`)
      continue
    }
    const f = fieldCandidate(wf, nodeId, e.field, oi)
    inputs.push({
      key: e.key?.trim() || f.key,
      type: f.type,
      label: e.label?.trim() || f.label,
      help: e.help,
      default: f.value,
      constraints: {
        ...f.constraints,
        ...(e.min !== undefined && { min: e.min }),
        ...(e.max !== undefined && { max: e.max }),
        ...(e.step !== undefined && { step: e.step })
      },
      target: { kind: 'field', nodeId, field: e.field },
      source: f.source,
      order: e.order ?? 1000 + idx,
      rank: TYPE_RANK[f.type]
    })
  }

  for (const id of Object.keys(overrides?.inputs ?? {})) {
    if (!discovery.candidates.some((c) => c.id === id)) warnings.push(`Override for "${id}" matches no input.`)
  }

  inputs.sort((a, b) => {
    const ao = a.order < 1000 ? a.order : null
    const bo = b.order < 1000 ? b.order : null
    if (ao !== null || bo !== null) return (ao ?? 1e9) - (bo ?? 1e9) || a.rank - b.rank
    return a.rank - b.rank || a.order - b.order
  })

  const counts = new Map<string, number>()
  for (const i of inputs) counts.set(i.key, (counts.get(i.key) ?? 0) + 1)
  const duplicateKeys = [...counts].filter(([, n]) => n > 1).map(([k]) => k)

  return {
    inputs: inputs.map(({ rank: _rank, ...rest }, i) => ({ ...rest, order: i })),
    seedTargets: discovery.seedTargets,
    duplicateKeys,
    discovery,
    warnings
  }
}
