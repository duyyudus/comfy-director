import { create } from 'zustand'
import type {
  AppEvent, AppSettings, ThemeMode, Attempt, ProjectInfo, ProjectTree, QueueSnapshot, ReconcileSummary, ServerStatus, WorkflowInfo
} from '@shared/types'
import { api, errorMessage } from './api'

export type Route =
  | { name: 'home' }
  | { name: 'shot'; shotId: number }
  | { name: 'sequence'; sequenceId: number }
  | { name: 'gallery' }
  | { name: 'library'; tab: 'prompts' | 'prompters' }
  | { name: 'settings' }
  | { name: 'import'; back: Route; replaceId?: string | null }
  | { name: 'compare'; shotId: number; attemptIds: number[] }

export type GlobalDialog =
  | { kind: 'new-shot'; sequenceId: number | null }
  | { kind: 'new-sequence' }
  | { kind: 'new-project' }
  | { kind: 'rename-project' }
  | null

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

/** Values to load into a shot form (Load settings / Load into shot / Use in shot). */
export interface PendingLoad {
  shotId: number
  workflowId: string
  values: Record<string, unknown>
  seed: number | null
}

interface State {
  ready: boolean
  settings: AppSettings | null
  server: ServerStatus
  workflows: WorkflowInfo[]
  projects: ProjectInfo[]
  tree: ProjectTree | null
  queue: QueueSnapshot
  queueOpen: boolean
  route: Route
  history: Route[]
  dialog: GlobalDialog
  reconcile: ReconcileSummary | null
  toasts: Toast[]
  dark: boolean
  /** Bumped when anything in the current project changes, so views refetch. */
  projectVersion: number
  lastAttempt: { projectPath: string; attempt: Attempt } | null
  pendingLoad: PendingLoad | null

  init(): Promise<void>
  go(r: Route): void
  back(): void
  setDialog(d: GlobalDialog): void
  toast(text: string, kind?: 'info' | 'error'): void
  dismissToast(id: number): void
  loadWorkflows(): Promise<void>
  loadProjects(): Promise<void>
  openProject(path: string | null): Promise<void>
  refreshTree(): Promise<void>
  setQueueOpen(v: boolean): void
  setSettings(s: AppSettings): void
  setReconcile(r: ReconcileSummary | null): void
  setPendingLoad(p: PendingLoad | null): void
  handleEvent(e: AppEvent): void
}

const emptyQueue: QueueSnapshot = { running: null, waiting: [], finished: [], ourWaitingCount: 0 }
let toastId = 0
let initStarted = false

const media = window.matchMedia('(prefers-color-scheme: dark)')
let themeMode: ThemeMode = 'auto'
/** Auto follows the OS live; Light and Dark are applied directly. */
function applyTheme(mode: ThemeMode = themeMode): boolean {
  themeMode = mode
  const dark = mode === 'dark' || (mode === 'auto' && media.matches)
  document.documentElement.classList.toggle('dark', dark)
  return dark
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: null,
  server: { state: 'unconfigured', serverName: '', serverUrl: '' },
  workflows: [],
  projects: [],
  tree: null,
  queue: emptyQueue,
  queueOpen: false,
  route: { name: 'home' },
  history: [],
  dialog: null,
  reconcile: null,
  toasts: [],
  dark: media.matches,
  projectVersion: 0,
  lastAttempt: null,
  pendingLoad: null,

  async init() {
    if (initStarted) return
    initStarted = true
    media.addEventListener('change', () => set({ dark: applyTheme() }))
    window.toolkit.onEvent((e) => get().handleEvent(e))
    const [settings, server, queue] = await Promise.all([api.getSettings(), api.getServerStatus(), api.getQueue()])
    set({ settings, server, queue, dark: applyTheme(settings.theme) })
    await Promise.all([get().loadWorkflows(), get().loadProjects()])
    const projects = get().projects
    const current = settings.currentProject && projects.find((p) => p.path === settings.currentProject && !p.missing)
    await get().openProject(current ? current.path : projects.find((p) => !p.missing)?.path ?? null)
    const summary = await api.takeReconcileSummary()
    set({ ready: true, ...(summary && { reconcile: summary }) })
  },

  go(r) {
    const { route, history } = get()
    set({ route: r, history: [...history.slice(-30), route], queueOpen: r.name === 'compare' ? false : get().queueOpen })
  },
  back() {
    const h = get().history
    const prev = h[h.length - 1]
    set({ route: prev ?? { name: 'home' }, history: h.slice(0, -1) })
  },
  setDialog(d) {
    set({ dialog: d })
  },
  toast(text, kind = 'info') {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  async loadWorkflows() {
    try {
      set({ workflows: await api.listWorkflows() })
    } catch (e) {
      get().toast(errorMessage(e), 'error')
    }
  },
  async loadProjects() {
    set({ projects: await api.listProjects() })
  },
  async openProject(path) {
    if (!path) {
      set({ tree: null, route: { name: 'home' } })
      return
    }
    try {
      const tree = await api.openProject(path)
      set({ tree, route: { name: 'home' }, history: [], projectVersion: get().projectVersion + 1 })
      set({ settings: await api.getSettings() })
    } catch (e) {
      get().toast(errorMessage(e), 'error')
    }
  },
  async refreshTree() {
    const t = get().tree
    if (!t) return
    try {
      set({ tree: await api.getProjectTree(t.project.path), projectVersion: get().projectVersion + 1 })
    } catch {
      /* project gone */
    }
  },
  setQueueOpen(v) {
    set({ queueOpen: v })
  },
  setSettings(s) {
    set({ settings: s, dark: applyTheme(s.theme) })
  },
  setReconcile(r) {
    set({ reconcile: r })
  },
  setPendingLoad(p) {
    set({ pendingLoad: p })
  },
  handleEvent(e) {
    switch (e.type) {
      case 'server':
        set({ server: e.status })
        break
      case 'queue':
        set({ queue: e.snapshot })
        break
      case 'attempt':
        set({ lastAttempt: { projectPath: e.projectPath, attempt: e.attempt } })
        break
      case 'project-changed':
        if (get().tree?.project.path === e.projectPath) void get().refreshTree()
        else set({ projectVersion: get().projectVersion + 1 })
        void get().loadProjects()
        break
      case 'workflows-changed':
        void get().loadWorkflows()
        break
      case 'reconciled':
        set({ reconcile: e.summary })
        void api.takeReconcileSummary()
        break
      case 'theme':
        set({ dark: applyTheme() })
        break
      case 'thumbnail':
        thumbnailListeners.forEach((l) => l(e.job))
        break
    }
  }
}))

type ThumbListener = (job: Extract<AppEvent, { type: 'thumbnail' }>['job']) => void
export const thumbnailListeners = new Set<ThumbListener>()

/** The current project's path (throws if none: views using it only render inside a project). */
export function useProjectPath(): string {
  return useStore((s) => s.tree?.project.path ?? '')
}
