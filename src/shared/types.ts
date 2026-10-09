import type { Overrides, SchemaInput, Values } from '../core/workflow/types'
import type { Candidate, FieldCandidate } from '../core/workflow/discover'
import type { ServerCheck } from '../core/workflow/check'
import type { SchemaDiff } from '../core/workflow/reconcile'
import type { PrompterConfig, PrompterType } from '../core/prompter/types'
import type { MediaKind } from '../core/output/naming'

export type ThemeMode = 'auto' | 'light' | 'dark'
/** What Reset workspace deletes: every project, or every project and every workflow. */
export type ResetScope = 'projects' | 'all'

/** Body text size in px; every other text size scales with it. */
export const FONT_SIZES = [13, 14, 15, 16, 18] as const
export const DEFAULT_FONT_SIZE = 15

export interface AppSettings {
  serverUrl: string
  workspacePath: string
  theme: ThemeMode
  fontSize: number
  clientId: string
  currentProject: string | null
  setupDone: boolean
  hasToken: boolean
  lastWorkflowId: string | null
}

export type ConnectionState = 'unconfigured' | 'connecting' | 'connected' | 'offline' | 'unauthorized'

export interface ServerStatus {
  state: ConnectionState
  serverName: string
  serverUrl: string
  message?: string
  retryAt?: number
  nodeTypeCount?: number
}

export interface WorkflowInfo {
  id: string
  name: string
  version: number
  hash: string
  importedAt: string
  nodeCount: number
  nodeTypeCount: number
  inputs: SchemaInput[]
  /** Number of seed fields driven by the Seed control. */
  seedCount: number
  duplicateKeys: string[]
  warnings: string[]
  overrides: Overrides
}

export interface ProjectInfo {
  path: string
  name: string
  shotCount: number
  missing: boolean
}

export interface Sequence {
  id: number
  name: string
  position: number
}

export type PromptMode = 'single' | 'list'
export type SeedMode = 'random' | 'fixed'

export interface Shot {
  id: number
  name: string
  sequenceId: number | null
  position: number | null
  workflowId: string | null
  values: Values
  promptMode: PromptMode
  promptList: string[]
  seedMode: SeedMode
  seedValue: number | null
  lastSeed: number | null
  runs: number
  keeperAttemptId: number | null
  createdAt: string
  updatedAt: string
}

export interface ShotSummary {
  id: number
  name: string
  sequenceId: number | null
  position: number | null
  hasKeeper: boolean
  attemptCount: number
  workflowId: string | null
}

export interface ProjectTree {
  project: ProjectInfo
  sequences: Sequence[]
  shots: ShotSummary[]
}

export type AttemptStatus = 'submitting' | 'queued' | 'running' | 'done' | 'cached' | 'failed' | 'cancelled'

export interface OutputFile {
  path: string
  kind: MediaKind
  filename: string
}

export interface AttemptError {
  message: string
  nodeId?: string
  nodeType?: string
  errorType?: string
  details?: string
  stoppedAt?: number
}

export interface Attempt {
  id: number
  shotId: number
  num: number
  workflowId: string
  workflowName: string
  workflowVersion: number
  workflowHash: string
  values: Values
  seed: number
  status: AttemptStatus
  promptId: string | null
  runId: string
  promptIndex: number
  promptCount: number
  runIndex: number
  runCount: number
  outputs: OutputFile[]
  thumb: string | null
  mediaDuration: number | null
  error: AttemptError | null
  progress: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface InputFile {
  name: string
  originalName: string
  path: string
}

export interface ShotDetail {
  shot: Shot
  sequence: Sequence | null
  attempts: Attempt[]
  totalAttempts: number
  inputs: Record<string, InputFile>
}

export interface RunRequest {
  workflowId: string
  values: Values
  promptMode: PromptMode
  prompts: string[]
  runs: number
  seedMode: SeedMode
  seedValue: number | null
}

export interface UploadFailure {
  key: string
  file: string
  message: string
}

export interface RunResult {
  ok: boolean
  attempts?: Attempt[]
  /** Problems per input key. */
  fieldErrors?: Record<string, string>
  uploadFailures?: UploadFailure[]
  message?: string
}

export interface QueueJob {
  promptId: string
  number: number
  ours: boolean
  projectPath?: string
  projectName?: string
  shotId?: number
  shotName?: string
  attemptId?: number
  attemptNum?: number
  workflowName?: string
  runId?: string
  runLabel?: string
  note?: string
  progress?: number
  stage?: string
  startedAt?: string | null
}

export interface FinishedJob {
  status: 'done' | 'cached' | 'failed' | 'cancelled'
  projectPath: string
  shotId: number
  shotName: string
  attemptId: number
  attemptNum: number
  workflowName: string
  finishedAt: string
  note: string
  error?: AttemptError | null
}

export interface QueueSnapshot {
  running: QueueJob | null
  waiting: QueueJob[]
  finished: FinishedJob[]
  ourWaitingCount: number
}

export interface ReconcileSummary {
  finished: FinishedJob[]
  failed: FinishedJob[]
  stillWaiting: number
}

export interface GalleryFilter {
  project: 'current' | 'all'
  search: string
  workflowId: string | null
  sequence: number | 'loose' | null
  keepersOnly: boolean
  groupBy: 'shot' | 'time'
  offset: number
  limit: number
}

export interface GalleryItem {
  projectPath: string
  projectName: string
  attempt: Attempt
  shotName: string
  shotPosition: number | null
  sequenceName: string | null
  sequenceId: number | null
  isKeeper: boolean
  shotAttemptCount: number
}

export interface GalleryPage {
  items: GalleryItem[]
  hasMore: boolean
  total: number
}

export interface ImportAnalysis {
  ok: boolean
  error?: string
  fileName: string
  suggestedName: string
  nodeCount: number
  nodeTypeCount: number
  candidates: Candidate[]
  fields: FieldCandidate[]
  seedFields: string[]
  check: ServerCheck | null
  /** Raw JSON text, sent back on commit. */
  text: string
  /** Existing workflow whose id matches the suggested name. */
  existingId: string | null
}

export interface ImportPreview {
  inputs: SchemaInput[]
  duplicateKeys: string[]
  diff: SchemaDiff | null
  previousVersion: number | null
  nextVersion: number
  hash: string
  removedInUse: { key: string; shots: number }[]
}

export interface ImportCommit {
  text: string
  name: string
  mode: 'replace' | 'new'
  replaceId: string | null
  overrides: Overrides
}

export interface LibraryPrompt {
  id: number
  name: string
  text: string
  tags: string[]
  note: string
  usedCount: number
  lastUsedAt: string | null
  lastUsedIn: string | null
  createdAt: string
  updatedAt: string
}

export interface PrompterRecord {
  id: number
  name: string
  type: PrompterType
  config: PrompterConfig
  createdAt: string
  updatedAt: string
}

/** A prompting guide for one class of workflows: `prompter/skills/<type>/skill.md` in the workspace. */
export interface PromptSkill {
  /** Workflow type: the folder name, e.g. `minimax_h3`. */
  type: string
  /** `name` and `description` from the file's front matter, when it has one. */
  name: string
  description: string
  /** Length of the file in characters. */
  size: number
  path: string
}

/** One message of a shot's prompt chat. */
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** Names of attached images in the project's `inputs/`, in the order they were attached. */
  images: string[]
  createdAt: string
}

export interface ShotChat {
  messages: ChatMessage[]
  /** Display names of the attached images. */
  files: Record<string, InputFile>
}

export interface GenerateOptions {
  count: number
  seed?: number
  currentPrompt: string
  ideas?: string[]
}

export interface ThumbnailJob {
  projectPath: string
  attemptId: number
  file: string
  kind: MediaKind
}

export type AppEvent =
  | { type: 'server'; status: ServerStatus }
  | { type: 'queue'; snapshot: QueueSnapshot }
  | { type: 'attempt'; projectPath: string; attempt: Attempt }
  | { type: 'project-changed'; projectPath: string }
  | { type: 'workflows-changed' }
  | { type: 'reconciled'; summary: ReconcileSummary }
  | { type: 'thumbnail'; job: ThumbnailJob }
  | { type: 'theme'; dark: boolean }
  /** The next piece of the reply a shot's prompt chat is waiting for. */
  | { type: 'chat-delta'; projectPath: string; shotId: number; delta: string }

export interface TestResult {
  ok: boolean
  message: string
  nodeTypeCount?: number
}
