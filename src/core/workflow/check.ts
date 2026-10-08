import type { ApiWorkflow } from './types'
import { brokenLinks, type BrokenLink } from './format'
import { isLink, titleOf } from './graph'
import { inputSpec, type ObjectInfo } from './objectInfo'

const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx)$/i

export interface ModelRef {
  nodeId: string
  nodeTitle: string
  field: string
  value: string
}

export interface ServerCheck {
  checked: boolean
  nodeTypes: string[]
  missingNodeTypes: string[]
  models: ModelRef[]
  missingModels: ModelRef[]
  brokenLinks: BrokenLink[]
}

/** Checks a workflow against `GET /object_info`. Missing types/models warn; broken links block. */
export function checkWorkflow(wf: ApiWorkflow, oi: ObjectInfo | null | undefined): ServerCheck {
  const nodeTypes = [...new Set(Object.values(wf).map((n) => n.class_type))]
  const models: ModelRef[] = []
  for (const [nodeId, node] of Object.entries(wf)) {
    for (const [field, v] of Object.entries(node.inputs)) {
      if (typeof v === 'string' && !isLink(v) && MODEL_EXT.test(v)) {
        models.push({ nodeId, nodeTitle: titleOf(node), field, value: v })
      }
    }
  }
  const missingModels = oi
    ? models.filter((m) => {
        const spec = inputSpec(oi, wf[m.nodeId].class_type, m.field)
        return spec?.options ? !spec.options.includes(m.value) : false
      })
    : []
  return {
    checked: !!oi,
    nodeTypes,
    missingNodeTypes: oi ? nodeTypes.filter((t) => !oi[t]) : [],
    models,
    missingModels,
    brokenLinks: brokenLinks(wf)
  }
}
