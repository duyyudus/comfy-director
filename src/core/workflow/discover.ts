import type { ApiWorkflow, FileMedia, InputConstraints, InputTarget, InputType, Link, SeedTarget } from './types'
import { consumersOf, isLink, titleOf, trailingNumber, type Consumer } from './graph'
import { humanize, keyFromTitle, SEED_FIELDS, titleInner } from './keys'
import { groupBounds, inputSpec, type InputSpec, type ObjectInfo } from './objectInfo'

/** An input found automatically (primitive node, file loader, group of file loaders). */
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

/** Nodes that load an uploaded file, with the field holding its name. */
const FILE_LOADERS: Record<string, { field: string; media: FileMedia }> = {
  LoadImage: { field: 'image', media: 'image' },
  LoadVideo: { field: 'file', media: 'video' },
  LoadAudio: { field: 'audio', media: 'audio' }
}

/** Nodes that only split a loaded file into its parts. The input is named after what they feed. */
const UNPACKERS = new Set(['GetVideoComponents'])

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
  const groups = new Map<string, { consumerId: string; prefix: string; slots: (FileSink & { nodeId: string })[] }>()

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

    const loader = FILE_LOADERS[node.class_type]
    if (loader) {
      const sink = fileSink(wf, nodeId)
      if (!sink) continue
      const consumer = sink.consumer
      const dot = consumer.input.indexOf('.')
      if (dot > 0) {
        const prefix = consumer.input.slice(0, dot)
        const gid = `${consumer.nodeId}\u0000${prefix}`
        const g = groups.get(gid) ?? { consumerId: consumer.nodeId, prefix, slots: [] }
        g.slots.push({ nodeId, ...sink })
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
        target: {
          kind: 'file', nodeId, field: loader.field, consumerId: consumer.nodeId, consumerInput: consumer.input,
          ...(sink.via && { via: sink.via }),
          ...(sink.also.length && { also: sink.also })
        },
        // Unknown (no server info): treated as optional, the server reports it if not.
        constraints: { required: spec ? !spec.optional : false, media: loader.media },
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
    g.slots.sort((a, b) => trailingNumber(a.consumer.input) - trailingNumber(b.consumer.input))
    const consumerNode = wf[g.consumerId]
    const spec = inputSpec(oi, consumerNode.class_type, g.prefix)
    const bounds = groupBounds(spec)
    const first = g.slots[0]
    const firstNode = wf[first.nodeId]
    const loader = FILE_LOADERS[firstNode.class_type]
    const slotBase = (input: string): string => input.slice(input.indexOf('.') + 1).replace(/\d+$/, '')
    // A video's audio track fills a slot group of its own, index for index.
    const also = first.also
      .filter((a) => a.input.includes('.'))
      .map((a) => ({ prefix: a.input.slice(0, a.input.indexOf('.')), base: slotBase(a.input), output: a.output }))
    candidates.push({
      id: g.prefix,
      key: g.prefix,
      type: 'file-group',
      label: humanize(g.prefix),
      source: `${g.slots.length} × ${titleOf(firstNode)} into ${g.prefix}.* on ${titleOf(consumerNode)}`,
      default: [],
      defaultExposed: true,
      target: {
        kind: 'file-group', consumerId: g.consumerId, prefix: g.prefix, base: slotBase(first.consumer.input),
        field: loader.field, output: first.output,
        slots: g.slots.map((s) => ({ nodeId: s.nodeId, input: s.consumer.input, ...(s.via && { via: s.via }) })),
        ...(also.length && { also })
      },
      constraints: {
        required: spec ? !spec.optional : false,
        minCount: bounds.min ?? (spec && !spec.optional ? 1 : 0),
        maxCount: bounds.max ?? g.slots.length,
        media: loader.media
      },
      nodeClass: firstNode.class_type
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

interface FileSink {
  /** The unpack node between the loader and the consumer, if any. */
  via?: string
  consumer: Consumer
  output: number
  /** Other inputs of the same consumer node fed by this file. */
  also: { input: string; output: number }[]
}

/** Where a loader's file ends up: its first consumer, looking through an unpack node. */
function fileSink(wf: ApiWorkflow, nodeId: string): FileSink | null {
  const direct = consumersOf(wf, nodeId)
  if (!direct.length) return null
  const via = UNPACKERS.has(wf[direct[0].nodeId].class_type) ? direct[0].nodeId : undefined
  const links = (via ? consumersOf(wf, via) : direct).map((c) => ({ ...c, output: (wf[c.nodeId].inputs[c.input] as Link)[1] }))
  const main = links[0]
  if (!main) return null
  return {
    via,
    consumer: { nodeId: main.nodeId, input: main.input },
    output: main.output,
    also: links.slice(1).filter((c) => c.nodeId === main.nodeId).map((c) => ({ input: c.input, output: c.output }))
  }
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
