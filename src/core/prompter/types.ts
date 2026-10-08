/** Prompters turn a recipe into a list of plain-text prompts. Swappable by type. */

export type PrompterType = 'template' | 'llm' | 'script'

export type SlotMode = 'random' | 'order' | 'same'

export interface TemplateConfig {
  template: string
  slots: Record<string, { mode: SlotMode; values: string[] }>
  count: number
  seed: number
  avoidRepeats: boolean
}

export interface LlmConfig {
  instruction: string
  /** `lines`: one idea per line, pasted when it runs. `shot-prompt`: the current shot prompt. */
  inputMode: 'lines' | 'shot-prompt'
  /** Base URL of an OpenAI-compatible API, e.g. http://localhost:11434/v1 */
  endpoint: string
  model: string
  apiKey?: string
  temperature: number
}

export interface ScriptConfig {
  path: string
  runtime: 'python' | 'node'
}

export type PrompterConfig =
  | { type: 'template'; template: TemplateConfig }
  | { type: 'llm'; llm: LlmConfig }
  | { type: 'script'; script: ScriptConfig }

export interface GenerateRequest {
  count: number
  seed: number
  currentPrompt: string
  /** Ideas for an LLM prompter in `lines` mode. */
  ideas?: string[]
}

export interface Prompter {
  generate(req: GenerateRequest): Promise<string[]>
}

export const DEFAULT_TEMPLATE: TemplateConfig = {
  template: '{subject} stands at the {location}, {lighting}.',
  slots: {},
  count: 6,
  seed: 48213,
  avoidRepeats: true
}

export const DEFAULT_LLM: LlmConfig = {
  instruction: 'Write one vivid video prompt for the idea below. Keep camera and lighting concrete. Under 80 words.',
  inputMode: 'lines',
  endpoint: 'http://localhost:11434/v1',
  model: 'llama3.1',
  temperature: 0.8
}

export const DEFAULT_SCRIPT: ScriptConfig = { path: '', runtime: 'python' }
