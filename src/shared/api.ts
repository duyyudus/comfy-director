import type {
  AppSettings, Attempt, GalleryFilter, GalleryPage, GenerateOptions, ImportAnalysis, ImportCommit, ImportPreview,
  InputFile, LibraryPrompt, ProjectInfo, ProjectTree, PrompterRecord, QueueSnapshot, ReconcileSummary, RunRequest, RunResult,
  Sequence, ServerStatus, Shot, ShotDetail, TestResult, ThemeMode, ThumbnailJob, WorkflowInfo
} from './types'
import type { Overrides } from '../core/workflow/types'
import type { PrompterConfig } from '../core/prompter/types'

/** Everything the renderer can ask the main process. Each method maps to one IPC call. */
export interface ToolkitApi {
  // settings & server
  getSettings(): Promise<AppSettings>
  setTheme(mode: ThemeMode): Promise<void>
  saveServer(url: string, token: string | null): Promise<ServerStatus>
  testConnection(url: string, token: string | null): Promise<TestResult>
  getServerStatus(): Promise<ServerStatus>
  retryConnection(): Promise<void>
  chooseWorkspace(): Promise<AppSettings | null>
  openWorkspaceFolder(): Promise<void>
  finishSetup(): Promise<void>
  syncedWarning(path: string): Promise<string | null>

  // workflows
  listWorkflows(): Promise<WorkflowInfo[]>
  pickWorkflowFile(): Promise<{ fileName: string; text: string } | null>
  analyzeWorkflow(fileName: string, text: string): Promise<ImportAnalysis>
  previewImport(text: string, overrides: Overrides, replaceId: string | null): Promise<ImportPreview>
  commitImport(commit: ImportCommit): Promise<WorkflowInfo>
  getWorkflowOverrides(id: string): Promise<Overrides>

  // projects
  listProjects(): Promise<ProjectInfo[]>
  createProject(name: string): Promise<ProjectInfo>
  openProject(path: string): Promise<ProjectTree>
  openExistingProject(): Promise<ProjectInfo | null>
  renameProject(path: string, name: string): Promise<ProjectInfo>
  removeProject(path: string): Promise<void>
  revealProject(path: string): Promise<void>
  projectFolderPreview(name: string): Promise<{ path: string; error: string | null }>
  getProjectTree(path: string): Promise<ProjectTree>

  // sequences & shots
  createSequence(projectPath: string, name: string): Promise<Sequence>
  renameSequence(projectPath: string, id: number, name: string): Promise<void>
  deleteSequence(projectPath: string, id: number): Promise<void>
  reorderShots(projectPath: string, sequenceId: number, shotIds: number[]): Promise<void>
  createShot(projectPath: string, name: string, sequenceId: number | null, workflowId: string | null): Promise<Shot>
  getShot(projectPath: string, shotId: number, attemptLimit?: number): Promise<ShotDetail>
  updateShot(projectPath: string, shotId: number, patch: Partial<Shot>): Promise<Shot>
  duplicateShot(projectPath: string, shotId: number): Promise<Shot>
  moveShot(projectPath: string, shotId: number, sequenceId: number | null, position: number | null): Promise<void>
  deleteShot(projectPath: string, shotId: number): Promise<void>
  getSequenceShots(projectPath: string, sequenceId: number): Promise<{ sequence: Sequence; shots: { shot: Shot; keeper: Attempt | null; attemptCount: number }[] }>
  exportKeepers(projectPath: string, sequenceId: number): Promise<{ count: number; folder: string }>

  // inputs
  pickImages(projectPath: string, multiple: boolean): Promise<InputFile[]>
  addInputFromPath(projectPath: string, filePath: string): Promise<InputFile>

  // attempts & runs
  run(projectPath: string, shotId: number, req: RunRequest): Promise<RunResult>
  retryAttempt(projectPath: string, attemptId: number, newSeed: boolean): Promise<RunResult>
  setKeeper(projectPath: string, shotId: number, attemptId: number | null): Promise<void>
  deleteAttempt(projectPath: string, attemptId: number): Promise<void>
  getAttempts(projectPath: string, ids: number[]): Promise<Attempt[]>
  cancelAttempt(projectPath: string, attemptId: number): Promise<void>
  revealFile(projectPath: string, relPath: string): Promise<void>
  saveThumbnail(projectPath: string, attemptId: number, pngBase64: string, duration: number | null): Promise<void>
  pendingThumbnails(): Promise<ThumbnailJob[]>

  // queue
  getQueue(): Promise<QueueSnapshot>
  cancelJobs(promptIds: string[]): Promise<void>
  cancelOtherClientJob(promptId: string): Promise<void>
  interrupt(promptId: string): Promise<void>
  cancelAllWaiting(): Promise<number>
  takeReconcileSummary(): Promise<ReconcileSummary | null>

  // gallery
  gallery(filter: GalleryFilter): Promise<GalleryPage>

  // library
  listPrompts(): Promise<LibraryPrompt[]>
  savePrompt(p: Partial<LibraryPrompt> & { name: string; text: string }): Promise<LibraryPrompt>
  deletePrompt(id: number): Promise<void>
  usePrompt(id: number, projectPath: string, shotId: number, mode: 'replace' | 'add'): Promise<void>
  markPromptsUsed(ids: number[], where: string): Promise<void>
  listPrompters(): Promise<PrompterRecord[]>
  savePrompter(p: { id?: number; name: string; config: PrompterConfig }): Promise<PrompterRecord>
  deletePrompter(id: number): Promise<void>
  generatePrompts(config: PrompterConfig, opts: GenerateOptions): Promise<string[]>
  pickScriptFile(): Promise<string | null>

  // misc
  mediaUrl(absPath: string): Promise<string>
  copyText(text: string): Promise<void>
}

export type ApiMethod = keyof ToolkitApi

export const API_METHODS: ApiMethod[] = [
  'getSettings', 'setTheme', 'saveServer', 'testConnection', 'getServerStatus', 'retryConnection', 'chooseWorkspace',
  'openWorkspaceFolder', 'finishSetup', 'syncedWarning',
  'listWorkflows', 'pickWorkflowFile', 'analyzeWorkflow', 'previewImport', 'commitImport', 'getWorkflowOverrides',
  'listProjects', 'createProject', 'openProject', 'openExistingProject', 'renameProject', 'removeProject', 'revealProject',
  'projectFolderPreview', 'getProjectTree',
  'createSequence', 'renameSequence', 'deleteSequence', 'reorderShots', 'createShot', 'getShot', 'updateShot',
  'duplicateShot', 'moveShot', 'deleteShot', 'getSequenceShots', 'exportKeepers',
  'pickImages', 'addInputFromPath',
  'run', 'retryAttempt', 'setKeeper', 'deleteAttempt', 'getAttempts', 'cancelAttempt', 'revealFile', 'saveThumbnail',
  'pendingThumbnails',
  'getQueue', 'cancelJobs', 'cancelOtherClientJob', 'interrupt', 'cancelAllWaiting', 'takeReconcileSummary',
  'gallery',
  'listPrompts', 'savePrompt', 'deletePrompt', 'usePrompt', 'markPromptsUsed', 'listPrompters', 'savePrompter',
  'deletePrompter', 'generatePrompts', 'pickScriptFile',
  'mediaUrl', 'copyText'
]

export const MEDIA_SCHEME = 'ctmedia'

/** URL for a local file, served by the main process (restricted to the workspace and known projects). */
export function mediaUrlFor(absPath: string, version?: string | number): string {
  return `${MEDIA_SCHEME}://f/?p=${encodeURIComponent(absPath)}${version !== undefined ? `&v=${version}` : ''}`
}

export function joinPath(dir: string, rel: string): string {
  return `${dir.replace(/[\\/]+$/, '')}/${rel}`
}
