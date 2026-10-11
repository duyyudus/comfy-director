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
  /** Hover text for the input (see `SchemaInput.tooltip`). */
  tooltip?: string
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

interface StandardField {
  /** Key and label when the field name alone would say too little (`switch`). */
  key?: string
  label?: string
  /** Hover text: what to start with and why. */
  tip?: string
  /** Bounds to use when the server's node info gives none. */
  constraints?: InputConstraints
  /** Narrows the rule to nodes that play the role the key names. */
  when?: (wf: ApiWorkflow, nodeId: string) => boolean
}

/** Literal fields on known node classes discovered as inputs (exposed by default). */
const STANDARD_FIELDS: Record<string, Record<string, StandardField>> = {
  ResolutionSelector: { aspect_ratio: {}, megapixels: {} },
  // SeedVR2 upscale: the factor of the resize step in front of the model.
  ResizeImageMaskNode: {
    'resize_type.multiplier': {
      key: 'scale_multiplier',
      label: 'Scale multiplier',
      tip: 'How much to enlarge the video before SeedVR2 runs. Start with 1.5. A larger factor makes the model invent more detail, and artifacts show up mostly at large output sizes.'
    }
  },
  // SeedVR2 upscale: the only sampler settings that could change how much the model invents. Other KSamplers are left alone.
  KSampler: {
    cfg: {
      tip: 'Guidance strength. Start with 1, the value of the SeedVR2 template: this one-step model is meant to run without guidance. Experimental, its effect here is not documented.',
      when: isSeedVr2Sampler
    },
    denoise: {
      tip: 'Start with 1 (full). Lower values start the sampler from less noise, and on this one-step model that may soften the result instead of keeping it closer to the source. Experimental: compare on a fixed seed.',
      constraints: { min: 0, max: 1, step: 0.01 },
      when: isSeedVr2Sampler
    }
  },
  // SeedVR2 upscale (numz's custom nodes): what sets the scale, the look and the batch seams. Model and memory settings stay fixed.
  SeedVR2VideoUpscaler: {
    resolution: {
      tip: 'Size of the shorter edge of the result; the aspect ratio is kept. Start with 1080. The more it enlarges, the more detail the model invents, and artifacts show up mostly at large output sizes.'
    },
    batch_size: {
      tip: 'Frames processed together; must be 4n+1 (1, 5, 9, 13...). Start with 5, the least that gives temporal consistency, or match the clip length. Higher is more consistent but needs much more VRAM. Use 1 only for single images.',
      constraints: { min: 1, step: 4, integer: true }
    },
    color_correction: {
      tip: 'How the colours of the result are matched to the source. Start with lab, the most faithful. Try wavelet if lab looks off. none keeps the colours the model produced.',
      constraints: { options: ['lab', 'wavelet', 'wavelet_adaptive', 'hsv', 'adain', 'none'] }
    },
    temporal_overlap: {
      tip: 'Frames shared between batches and blended. Start with 0. Raise it to 2 or 3 if the joins between batches flicker or cut. It only matters when the clip takes more than one batch.',
      constraints: { min: 0, max: 16, step: 1, integer: true }
    },
    input_noise_scale: {
      tip: 'Noise added to the input, 0 to 1. Start with 0. Try 0.1 to 0.3 if large output sizes show artifacts. Guides disagree on whether more or less helps over-sharpening on clean footage, so compare on a fixed seed.',
      constraints: { min: 0, max: 1, step: 0.01 }
    },
    latent_noise_scale: {
      tip: 'Noise added while the model works, 0 to 1. Start with 0. A small value (about 0.05 to 0.15) softens excess detail: the nearest thing to a "less AI look" control.',
      constraints: { min: 0, max: 1, step: 0.01 }
    }
  },
  // SeedVR2 upscale (numz): the model, and the memory settings that decide whether and how fast a clip fits on the GPU.
  SeedVR2LoadDiTModel: {
    model: {
      tip: 'The upscaling model. Start with seedvr2_ema_7b_fp16, the best quality offered. 3B is faster and lighter. fp8 and GGUF Q8 save VRAM for a small quality cost, Q4 for more. The "sharp" 7B variants add more detail.'
    },
    offload_device: {
      tip: 'Where the model waits while it is not running. none keeps it on the GPU: fastest, most VRAM. cpu frees VRAM, which long or large clips may need. Start with none, and set cpu when you use blocks_to_swap or run out of memory.'
    },
    blocks_to_swap: {
      tip: 'Transformer blocks moved to the CPU to save VRAM: 0 is off, up to 36 on 7B (32 on 3B). Start with 0 and raise it (try 16) only on out-of-memory errors, since more swapping is slower. It only works when offload_device is not none.',
      constraints: { min: 0, max: 36, step: 1, integer: true }
    }
  },
  SeedVR2LoadVAEModel: {
    encode_tiled: {
      tip: 'Encode the video in tiles. Start with it off, which is faster, and turn it on if you run out of memory while encoding. Tile seams are possible; the tile size and overlap are set in the workflow.'
    },
    decode_tiled: {
      tip: 'Decode the result in tiles. Start with it off, which is faster, and turn it on if you run out of memory while decoding. Tile seams are possible; the tile size and overlap are set in the workflow.'
    }
  },
  // SeedVR2 upscale: an if/else switch that picks the trimmed clip (a `Video Slice` on `on_true`) over the whole video.
  ComfySwitchNode: {
    switch: {
      key: 'trim_video',
      label: 'Trim video',
      tip: 'Off upscales the whole video. On upscales only the clip cut by the Video Slice node of the workflow. Its start time and duration are not inputs here, so they stay as in the workflow file.',
      when: (wf, nodeId) => {
        const on = wf[nodeId].inputs.on_true
        return isLink(on) && wf[on[0]]?.class_type === 'Video Slice'
      }
    }
  }
}

function isSeedVr2Sampler(wf: ApiWorkflow, nodeId: string): boolean {
  const positive = wf[nodeId].inputs.positive
  return isLink(positive) && wf[positive[0]]?.class_type === 'SeedVR2Conditioning'
}

const SWITCH_BRANCH_INPUTS = new Set(['on_true', 'on_false'])

/** Hover text for primitive inputs, by key. */
const PRIMITIVE_TIPS: Record<string, string> = {
  'split latent': 'Off upscales the whole clip in one go. On cuts the video into chunks (sized from the free VRAM) and merges them back, which uses less VRAM and may be much faster on long or large clips. The chunks are not overlapped, so a seam between them is possible.'
}

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
      const key = keyFromTitle(title)
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
        nodeClass: node.class_type,
        ...(PRIMITIVE_TIPS[key] && { tooltip: PRIMITIVE_TIPS[key] })
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
      // A video feeding `image` (frames from a Get Video Components node) is still a video: same key in every workflow.
      const key = loader.media !== 'image' && /^images?$/.test(consumer.input) ? loader.media : consumer.input
      candidates.push({
        id: key,
        key,
        type: 'file',
        label: humanize(key),
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
      const std = STANDARD_FIELDS[node.class_type]?.[field]
      if (std && (!std.when || std.when(wf, nodeId))) {
        const key = std.key ?? field
        candidates.push({
          id: key,
          key,
          type: std.constraints?.options && f.type === 'text' ? 'select' : f.type,
          label: std.label ?? f.label,
          source: `${title} · ${node.class_type}.${field}`,
          default: value,
          defaultExposed: true,
          target: { kind: 'field', nodeId, field },
          constraints: { ...std.constraints, ...f.constraints },
          nodeClass: node.class_type,
          ...(std.tip && { tooltip: std.tip })
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
