/** API-format workflow: flat map of node id -> node. Node ids are opaque strings. */
export interface ApiNode {
  inputs: Record<string, unknown>
  class_type: string
  _meta?: { title?: string }
}
export type ApiWorkflow = Record<string, ApiNode>
export type Link = [string, number]

export type InputType = 'text' | 'number' | 'toggle' | 'select' | 'file' | 'file-group'

export type InputTarget =
  /** A literal value on a node (primitive `value`, or an exposed field on a regular node). */
  | { kind: 'field'; nodeId: string; field: string }
  /** One LoadImage node feeding one consumer input. */
  | { kind: 'file'; nodeId: string; field: string; consumerId: string; consumerInput: string }
  /** Several LoadImage nodes feeding `<prefix>.<base>N` inputs on one consumer node. */
  | { kind: 'file-group'; consumerId: string; prefix: string; base: string; slots: { nodeId: string; input: string }[] }

export interface InputConstraints {
  min?: number
  max?: number
  step?: number
  integer?: boolean
  options?: string[]
  required?: boolean
  minCount?: number
  maxCount?: number
  multiline?: boolean
}

export interface SchemaInput {
  key: string
  type: InputType
  label: string
  help?: string
  default: unknown
  constraints: InputConstraints
  target: InputTarget
  /** Human description of where the value is written, e.g. "Float (Duration) · PrimitiveFloat". */
  source: string
  order: number
}

export interface SeedTarget {
  nodeId: string
  field: string
}

export interface WorkflowSchema {
  inputs: SchemaInput[]
  seedTargets: SeedTarget[]
  /** Keys shared by two exposed inputs (the Import screen asks for a rename). */
  duplicateKeys: string[]
}

/** Sidecar `overrides.json`: exceptions only. */
export interface Overrides {
  /** Per discovered candidate (by candidate id = derived key, `key#2` for repeats). */
  inputs?: Record<string, InputOverride>
  /** Fields on regular nodes to expose. */
  expose?: ExposeEntry[]
}

export interface InputOverride {
  hidden?: boolean
  key?: string
  label?: string
  help?: string
  order?: number
  min?: number
  max?: number
  step?: number
  minCount?: number
  maxCount?: number
}

export interface ExposeEntry {
  class: string
  /** Optional node title, matched after normalisation. Without it, the first node of the class is used. */
  title?: string
  field: string
  key?: string
  label?: string
  help?: string
  order?: number
  min?: number
  max?: number
  step?: number
}

/** A value map, keyed by input key. */
export type Values = Record<string, unknown>
