import type { Prompter, PrompterConfig } from './types'
import { TemplatePrompter } from './template'
import { LlmPrompter } from './llm'
import { ScriptPrompter } from './script'

export * from './types'
export { templateSlots, renderTemplate, TemplatePrompter } from './template'
export { LlmPrompter, promptFromReply, splitReply, systemPrompt } from './llm'
export type { ChatPart, ChatTurn, ReplyPart } from './llm'
export { ScriptPrompter, parseScriptOutput } from './script'
export { mulberry32 } from './rng'

/** `skill` is the text of the LLM prompter's skill file, read by the caller. */
export function createPrompter(cfg: PrompterConfig, skill: string | null = null): Prompter {
  switch (cfg.type) {
    case 'template':
      return new TemplatePrompter(cfg.template)
    case 'llm':
      return new LlmPrompter(cfg.llm, skill)
    case 'script':
      return new ScriptPrompter(cfg.script)
  }
}
