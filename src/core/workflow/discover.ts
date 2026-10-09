import type { ApiWorkflow, InputConstraints, InputTarget, InputType, SeedTarget } from './types'
import { consumersOf, isLink, titleOf, trailingNumber } from './graph'
import { humanize, keyFromTitle, SEED_FIELDS, titleInner } from './keys'
import { groupBounds, inputSpec, type InputSpec, type ObjectInfo } from './objectInfo'

/** An input found automatically (primitive node, LoadImage, LoadImage group). */
export interface Candidate {
  /** Stable id used by overrides: the derived key, or `key#2`, `key#3` for repeats. */
  id: string
  key: string
  type: InputType
  label: string
  source: string
  default: unknown
  defaultExposed: boolean
  target: InputTarget
  constraints: InputConstraints
  nodeClass: string
}

/** A literal field on a regular node that can be exposed through overrides. */
export interface FieldCandidate {
  nodeId: string
  nodeClass: string
  title: string
  field: string
  value: unknown
  key: string
  label: string
  type: InputType
  constraints: InputConstraints
  source: string
  suggested: boolean
}

export interface Discovery {
  candidates: Candidate[]
  fields: FieldCandidate[]
  seedTargets: SeedTarget[]
}

const PRIMITIVES: Record<string, { type: InputType; integer?: boolean; multiline?: boolean }> = {
  PrimitiveStringMultiline: { type: 'text', multiline: true },
  PrimitiveString: { type: 'text' },
  PrimitiveInt: { type: 'number', integer: true },
  PrimitiveFloat: { type: 'number' },
  PrimitiveBoolean: { type: 'toggle' }
}

const FILE_LOADERS = new Set(['LoadImage'])

const SUGGESTED_FIELDS = new Set([
  'prompt', 'text', 'negative', 'negative_prompt', 'aspect_ratio', 'megapixels', 'width', 'height',
  'steps', 'cfg', 'length', 'duration', 'num_frames', 'batch_size'
])

/** Literal string fields discovered as inputs (exposed by default). */
const PROMPT_FIELDS = new Set(['prompt'])

/** Literal fields on known node classes discovered as inputs (exposed by default). */
const STANDARD_FIELDS: Record<string, Set<string>> = {
  ResolutionSelector: new Set(['aspect_ratio', 'megapixels'])
}

const SWITCH_BRANCH_INPUTS = new Set(['on_true', 'on_false'])

export function discover(wf: ApiWorkflow, oi?: ObjectInfo | null): Discovery {
  const candidates: Candidate[] = []
  const fields: FieldCandidate[] = []
  const seedTargets: SeedTarget[] = []
  const groups = new Map<string, { consumerId: string; prefix: string; slots: { nodeId: string; input: string }[] }>()

  for (const [nodeId, node] of Object.entries(wf)) {
    const title = titleOf(node)
    const prim = PRIMITIVES[node.class_type]
    if (prim) {
      const consumers = consumersOf(wf, nodeId)
      const internal = consumers.length > 0 && consumers.every((c) => SWITCH_BRANCH_INPUTS.has(c.input))
      const constraints: InputConstraints = { integer: prim.integer, multiline: prim.multiline }
      // Numeric bounds: the consumer's input spec is more meaningful than the primitive's huge range.
      if (prim.type === 'number') {
        const specs = consumers
          .map((c) => inputSpec(oi, wf[c.nodeId].class_type, c.input))
          .filter((s): s is InputSpec => !!s && (s.type === 'INT' || s.type === 'FLOAT'))
        const own = inputSpec(oi, node.class_type, 'value')
        const s = specs[0] ?? own
        if (s) Object.assign(constraints, { min: s.min, max: s.max, step: s.step })
        if (prim.integer) constraints.step = constraints.step ?? 1
      }
      const key = keyFromTitle(title)
      candidates.push({
        id: key,
        key,
        type: prim.type,
        label: titleInner(title),
        source: `${title} · ${node.class_type}`,
        default: node.inputs.value,
        defaultExposed: !internal,
        target: { kind: 'field', nodeId, field: 'value' },
        constraints,
        nodeClass: node.class_type
      })
      continue
    }

    if (FILE_LOADERS.has(node.class_type)) {
      const consumer = consumersOf(wf, nodeId)[0]
      if (!consumer) continue
      const dot = consumer.input.indexOf('.')
      if (dot > 0) {
        const prefix = consumer.input.slice(0, dot)
        const gid = `${consumer.nodeId}\u0000${prefix}`
        const g = groups.get(gid) ?? { consumerId: consumer.nodeId, prefix, slots: [] }
        g.slots.push({ nodeId, input: consumer.input })
        groups.set(gid, g)
        continue
      }
      const consumerNode = wf[consumer.nodeId]
      const spec = inputSpec(oi, consumerNode.class_type, consumer.input)
      candidates.push({
        id: consumer.input,
        key: consumer.input,
        type: 'file',
        label: humanize(consumer.input),
        source: `${title} into ${consumer.input} on ${titleOf(consumerNode)}`,
        default: null,
        defaultExposed: true,
        target: { kind: 'file', nodeId, field: 'image', consumerId: consumer.nodeId, consumerInput: consumer.input },
        // Unknown (no server info): treated as optional, the server reports it if not.
        constraints: { required: spec ? !spec.optional : false },
        nodeClass: node.class_type
      })
      continue
    }

    for (const [field, value] of Object.entries(node.inputs)) {
      if (isLink(value) || Array.isArray(value) || (value !== null && typeof value === 'object')) continue
      if (SEED_FIELDS.has(field) && typeof value === 'number') {
        seedTargets.push({ nodeId, field })
        continue
      }
      const f = fieldCandidate(wf, nodeId, field, oi)
      if (PROMPT_FIELDS.has(field) && f.type === 'text') {
        // A prompt typed directly on a regular node (fl2vid, t2v) is as much an input as a prompt node.
        candidates.push({
          id: field,
          key: field,
          type: 'text',
          label: f.label,
          source: `${title} · ${node.class_type}.${field}`,
          default: value,
          defaultExposed: true,
          target: { kind: 'field', nodeId, field },
          constraints: { ...f.constraints, multiline: true },
          nodeClass: node.class_type
        })
        continue
      }
      if (STANDARD_FIELDS[node.class_type]?.has(field)) {
        candidates.push({
          id: field,
          key: field,
          type: f.type,
          label: f.label,
          source: `${title} · ${node.class_type}.${field}`,
          default: value,
          defaultExposed: true,
          target: { kind: 'field', nodeId, field },
          constraints: f.constraints,
          nodeClass: node.class_type
        })
        continue
      }
      fields.push(f)
    }
  }

  for (const g of groups.values()) {
    g.slots.sort((a, b) => trailingNumber(a.input) - trailingNumber(b.input))
    const consumerNode = wf[g.consumerId]
    const spec = inputSpec(oi, consumerNode.class_type, g.prefix)
    const bounds = groupBounds(spec)
    const slotName = g.slots[0].input.slice(g.prefix.length + 1)
    const base = slotName.replace(/\d+$/, '')
    candidates.push({
      id: g.prefix,
      key: g.prefix,
      type: 'file-group',
      label: humanize(g.prefix),
      source: `${g.slots.length} × Load Image into ${g.prefix}.* on ${titleOf(consumerNode)}`,
      default: [],
      defaultExposed: true,
      target: { kind: 'file-group', consumerId: g.consumerId, prefix: g.prefix, base, slots: g.slots },
      constraints: {
        required: spec ? !spec.optional : false,
        minCount: bounds.min ?? (spec && !spec.optional ? 1 : 0),
        maxCount: bounds.max ?? g.slots.length
      },
      nodeClass: 'LoadImage'
    })
  }

  // Repeated keys get `#2`, `#3` ids so overrides can address each one.
  const seen = new Map<string, number>()
  for (const c of candidates) {
    const n = (seen.get(c.key) ?? 0) + 1
    seen.set(c.key, n)
    if (n > 1) c.id = `${c.key}#${n}`
  }

  return { candidates, fields, seedTargets }
}

export function fieldCandidate(wf: ApiWorkflow, nodeId: string, field: string, oi?: ObjectInfo | null): FieldCandidate {
  const node = wf[nodeId]
  const value = node.inputs[field]
  const spec = inputSpec(oi, node.class_type, field)
  let type: InputType = typeof value === 'boolean' ? 'toggle' : typeof value === 'number' ? 'number' : 'text'
  const constraints: InputConstraints = {}
  if (spec) {
    if (spec.type === 'COMBO' && spec.options) {
      type = 'select'
      constraints.options = spec.options
    } else if (spec.type === 'INT' || spec.type === 'FLOAT') {
      type = 'number'
      Object.assign(constraints, { min: spec.min, max: spec.max, step: spec.step, integer: spec.type === 'INT' })
    } else if (spec.type === 'BOOLEAN') type = 'toggle'
    else if (spec.type === 'STRING') {
      type = 'text'
      constraints.multiline = spec.multiline
    }
  } else if (type === 'text') {
    constraints.multiline = field.includes('prompt') || field === 'text'
  }
  if (field === 'prompt' || field === 'text') constraints.multiline = true
  const title = titleOf(node)
  return {
    nodeId,
    nodeClass: node.class_type,
    title,
    field,
    value,
    key: field,
    label: humanize(field),
    type,
    constraints,
    source: `${title} · ${field} = ${String(value)}`,
    suggested: !field.includes('.') && (SUGGESTED_FIELDS.has(field) || !!spec?.multiline)
  }
}
