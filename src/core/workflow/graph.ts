import type { ApiNode, ApiWorkflow, Link } from './types'

export function isLink(v: unknown): v is Link {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number'
}

export function cloneWorkflow(wf: ApiWorkflow): ApiWorkflow {
  return JSON.parse(JSON.stringify(wf)) as ApiWorkflow
}

export function titleOf(node: ApiNode): string {
  return node._meta?.title?.trim() || node.class_type
}

export interface Consumer {
  nodeId: string
  input: string
}

/** All (node, input) pairs that link to `nodeId`, in workflow order. */
export function consumersOf(wf: ApiWorkflow, nodeId: string): Consumer[] {
  const out: Consumer[] = []
  for (const [id, node] of Object.entries(wf)) {
    for (const [input, v] of Object.entries(node.inputs ?? {})) {
      if (isLink(v) && v[0] === nodeId) out.push({ nodeId: id, input })
    }
  }
  return out
}

/** A node id not used in the workflow. Prefers the next free integer after the largest numeric id. */
export function freeNodeId(wf: ApiWorkflow, taken: Set<string> = new Set()): string {
  let max = 0
  for (const id of Object.keys(wf)) {
    if (/^\d+$/.test(id)) max = Math.max(max, Number(id))
  }
  let n = max + 1
  while (wf[String(n)] || taken.has(String(n))) n++
  return String(n)
}

export function trailingNumber(s: string): number {
  const m = s.match(/(\d+)$/)
  return m ? Number(m[1]) : Number.NaN
}

/** Follows an input through value nodes (a primitive's `value`, a switch's chosen branch) to a literal, or null. */
function resolveLiteral(wf: ApiWorkflow, v: unknown, depth = 0): unknown {
  if (!isLink(v)) return v
  const node = wf[v[0]]
  if (!node || depth > 20) return null
  const inputs = node.inputs ?? {}
  if (/Switch/.test(node.class_type) && 'switch' in inputs) {
    const on = resolveLiteral(wf, inputs.switch, depth + 1)
    if (on === null || on === undefined) return null // an unknown selector must not default to a branch
    return resolveLiteral(wf, on ? inputs.on_true : inputs.on_false, depth + 1)
  }
  if ('value' in inputs) return resolveLiteral(wf, inputs.value, depth + 1)
  return null
}

/** The sampling step count a graph will run: the first node with a `steps` input, resolved through switches and primitives. */
export function graphSteps(wf: ApiWorkflow): number | null {
  for (const node of Object.values(wf)) {
    if (!node.inputs || !('steps' in node.inputs)) continue
    const n = resolveLiteral(wf, node.inputs.steps)
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return null
}
