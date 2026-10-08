import type { ApiWorkflow } from './types'
import { isLink } from './graph'

export type FormatResult =
  | { format: 'api'; workflow: ApiWorkflow; nodeCount: number; nodeTypeCount: number }
  | { format: 'ui'; message: string }
  | { format: 'invalid'; message: string }

const UI_MESSAGE =
  'This file is in the graph (UI) format, which cannot be run. In ComfyUI, turn on Dev mode options in the settings, then use Workflow > Export (API) / Save (API Format) and import that file.'

export function detectFormat(data: unknown): FormatResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { format: 'invalid', message: 'The file is not a JSON object.' }
  }
  const obj = data as Record<string, unknown>
  if (Array.isArray(obj.nodes) && ('links' in obj || 'version' in obj || 'last_node_id' in obj)) {
    return { format: 'ui', message: UI_MESSAGE }
  }
  const entries = Object.entries(obj)
  if (entries.length === 0) return { format: 'invalid', message: 'The workflow has no nodes.' }
  for (const [id, node] of entries) {
    if (!node || typeof node !== 'object') return { format: 'invalid', message: `Entry "${id}" is not a node.` }
    const n = node as Record<string, unknown>
    if (typeof n.class_type !== 'string' || !n.inputs || typeof n.inputs !== 'object') {
      return { format: 'invalid', message: `Entry "${id}" has no class_type or inputs. Is this an API-format export?` }
    }
  }
  const wf = obj as unknown as ApiWorkflow
  return {
    format: 'api',
    workflow: wf,
    nodeCount: entries.length,
    nodeTypeCount: new Set(Object.values(wf).map((n) => n.class_type)).size
  }
}

export interface BrokenLink {
  nodeId: string
  input: string
  target: string
}

export function brokenLinks(wf: ApiWorkflow): BrokenLink[] {
  const out: BrokenLink[] = []
  for (const [id, node] of Object.entries(wf)) {
    for (const [input, v] of Object.entries(node.inputs)) {
      if (isLink(v) && !wf[v[0]]) out.push({ nodeId: id, input, target: v[0] })
    }
  }
  return out
}
