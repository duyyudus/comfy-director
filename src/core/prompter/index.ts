import type { Prompter, PrompterConfig } from './types'
import { TemplatePrompter } from './template'
import { LlmPrompter } from './llm'
import { ScriptPrompter } from './script'

export * from './types'
export { templateSlots, renderTemplate, TemplatePrompter } from './template'
export { LlmPrompter } from './llm'
export { ScriptPrompter, parseScriptOutput } from './script'
export { mulberry32 } from './rng'

export function createPrompter(cfg: PrompterConfig): Prompter {
  switch (cfg.type) {
    case 'template':
      return new TemplatePrompter(cfg.template)
    case 'llm':
      return new LlmPrompter(cfg.llm)
    case 'script':
      return new ScriptPrompter(cfg.script)
  }
}
