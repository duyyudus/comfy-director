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
