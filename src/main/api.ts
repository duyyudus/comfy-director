import { app, BrowserWindow, clipboard, dialog, nativeImage, nativeTheme, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { settings, updateSettings, publicSettings, getToken, setToken } from './settings'
import { Workspace, sha256, workflowIdFromName } from './workspace'
import { ServerManager } from './server'
import type { JobManager } from './jobs'
import type { ToolkitApi } from '@shared/api'
import { mediaUrlFor } from '@shared/api'
import { FONT_SIZES } from '@shared/types'
import type {
  AppEvent, GalleryFilter, GalleryItem, ImportAnalysis, ImportPreview, InputFile, ProjectTree, ShotChat, ThumbnailJob
} from '@shared/types'
import { detectFormat } from '@core/workflow/format'
import { discover } from '@core/workflow/discover'
import { buildSchema } from '@core/workflow/schema'
import { checkWorkflow } from '@core/workflow/check'
import { diffSchemas } from '@core/workflow/reconcile'
import { keeperExportPath, extOf, looksSynced, safeName } from '@core/output/naming'
import { createPrompter, LlmPrompter } from '@core/prompter'
import type { ChatPart, ChatTurn, LlmConfig } from '@core/prompter'
import { randomSeed } from '@core/planner'
import { titleOf } from '@core/workflow/graph'
import type { FileMedia } from '@core/workflow/types'
import { ComfyClient, ComfyError } from '@core/comfy/client'
import { SERVER_FOLDERS, serverFilePath } from '@core/comfy/files'

export interface Context {
  ws: () => Workspace
  setWorkspace: (w: Workspace) => void
  server: ServerManager
  jobs: JobManager
  emit: (e: AppEvent) => void
  window: () => BrowserWindow | null
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
/** What each kind of file input accepts. Video and audio are limited to what the app can also play back. */
const INPUT_FILES: Record<FileMedia, { extensions: string[]; filter: string; one: string; many: string; error: string }> = {
  image: { extensions: IMAGE_EXT, filter: 'Images', one: 'Choose an image', many: 'Choose images', error: 'Only PNG, JPG, WEBP and BMP images can be used.' },
  video: { extensions: ['mp4', 'mov', 'webm'], filter: 'Videos', one: 'Choose a video', many: 'Choose videos', error: 'Only MP4, MOV and WEBM videos can be used.' },
  audio: { extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'], filter: 'Audio', one: 'Choose an audio file', many: 'Choose audio files', error: 'Only WAV, MP3, FLAC, OGG and M4A audio can be used.' }
}
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
/** Longest side of an image sent to an LLM. Larger ones are scaled down to keep the request small. */
const CHAT_IMAGE_MAX = 1568
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' }

function imageDataUrl(file: string): string {
  const img = nativeImage.createFromPath(file)
  const { width, height } = img.getSize()
  // nativeImage reads PNG and JPEG; anything else (or a small picture) is sent as the file is.
  if (img.isEmpty() || Math.max(width, height) <= CHAT_IMAGE_MAX) {
    return `data:${IMAGE_MIME[extOf(file)] ?? 'image/png'};base64,${readFileSync(file).toString('base64')}`
  }
  const scaled = width >= height ? img.resize({ width: CHAT_IMAGE_MAX, quality: 'best' }) : img.resize({ height: CHAT_IMAGE_MAX, quality: 'best' })
  return `data:image/jpeg;base64,${scaled.toJPEG(90).toString('base64')}`
}

export function createApi(ctx: Context): ToolkitApi {
  const ws = ctx.ws
  const oi = (): ReturnType<() => ServerManager['objectInfo']> => ctx.server.objectInfo
  const win = (): BrowserWindow | undefined => ctx.window() ?? undefined
  const serverClient = (): ComfyClient => {
    if (!ctx.server.connected || !ctx.server.client) throw new Error('The server is not connected.')
    return ctx.server.client
  }

  const tree = (path: string): ProjectTree => {
    const pdb = ws().project(path)
    return {
      project: { path: resolve(path), name: ws().projectName(path), shotCount: pdb.shotCount(), missing: false },
      sequences: pdb.sequences(),
      shots: pdb.shotSummaries()
    }
  }

  const copyInput = (projectPath: string, src: string): InputFile => {
    const data = readFileSync(src)
    const ext = (extname(src).slice(1) || 'png').toLowerCase()
    const name = `${sha256(data).slice(0, 20)}.${ext}`
    const dest = join(projectPath, 'inputs', name)
    mkdirSync(join(projectPath, 'inputs'), { recursive: true })
    if (!existsSync(dest)) writeFileSync(dest, data)
    ws().project(projectPath).addInput(name, basename(src))
    return { name, originalName: basename(src), path: `inputs/${name}` }
  }

  /** The whole skill file of an LLM prompter, read fresh so edits on disk apply. Null when it has none. */
  const skillText = (cfg: LlmConfig): string | null => {
    if (!cfg.skill) return null
    const s = ws().skill(cfg.skill)
    if (!s) throw new Error(`This prompter's skill is missing: no skill.md in ${ws().skillDir(cfg.skill)}. Add it again in Library > Prompters, or set the prompter to no skill.`)
    return s.text
  }

  /** Replies being written, by project and shot, so Stop can abort them. */
  const chatsInFlight = new Map<string, AbortController>()
  const chatKey = (projectPath: string, shotId: number): string => `${resolve(projectPath)}#${shotId}`

  const shotChat = (projectPath: string, shotId: number): ShotChat => {
    const pdb = ws().project(projectPath)
    const messages = pdb.chat(shotId)
    const names = [...new Set(messages.flatMap((m) => m.images))]
    return { messages, files: Object.fromEntries(pdb.inputs(names).map((i) => [i.name, i])) }
  }

  const api: ToolkitApi = {
    /* ------------------------------------------------------- settings */
    async getSettings() {
      return publicSettings(ws().app.getMeta('last_workflow'))
    },
    async setTheme(mode) {
      updateSettings({ theme: mode })
      nativeTheme.themeSource = mode === 'auto' ? 'system' : mode
    },
    async setFontSize(size) {
      if (!(FONT_SIZES as readonly number[]).includes(size)) throw new Error(`Unsupported text size: ${size}`)
      updateSettings({ fontSize: size })
    },
    async saveServer(url, token) {
      updateSettings({ serverUrl: url.trim() })
      if (token !== null) setToken(token || null)
      ctx.server.configure(settings().serverUrl, getToken(), settings().clientId)
      return ctx.server.status
    },
    async testConnection(url, token) {
      return ServerManager.test(url, token ?? getToken())
    },
    async getServerStatus() {
      return ctx.server.status
    },
    async retryConnection() {
      ctx.server.retryNow()
    },
    async chooseWorkspace() {
      const r = await dialog.showOpenDialog(win()!, {
        title: 'Choose or create a workspace folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: settings().workspacePath
      })
      if (r.canceled || !r.filePaths[0]) return null
      const path = r.filePaths[0]
      ws().close()
      ctx.setWorkspace(new Workspace(path))
      updateSettings({ workspacePath: path, currentProject: null })
      ctx.jobs.loadActive()
      ctx.emit({ type: 'workflows-changed' })
      return publicSettings(ws().app.getMeta('last_workflow'))
    },
    async openWorkspaceFolder() {
      await shell.openPath(ws().root)
    },
    async resetWorkspace(scope) {
      if (scope !== 'projects' && scope !== 'all') throw new Error(`Unknown reset scope: ${String(scope)}`)
      const refuseIfBusy = (): void => {
        const busy = ws().projectWithActiveJobs()
        if (busy) throw new Error(`"${busy}" still has queued or running jobs. Cancel them or wait until they finish, then reset the workspace.`)
      }
      refuseIfBusy()
      const external = ws().externalProjects().length
      const inside = ws().app.projects().length - external
      const detail = [
        `Everything in ${ws().projectsDir()} (${count(inside, 'project')}) is moved to the system trash: shots, attempts, input images and rendered files.`
      ]
      if (external) {
        detail.push(`${count(external, 'project')} stored outside the workspace ${external === 1 ? 'is' : 'are'} removed from the list. ${external === 1 ? 'Its folder is' : 'Their folders are'} not touched.`)
      }
      if (scope === 'all') {
        detail.push(`Everything in ${join(ws().root, 'workflows')} (${count(ws().app.workflows().length, 'workflow')}) is moved to the system trash too, and the version history is cleared.`)
      } else detail.push('Workflows are kept.')
      detail.push('The prompt library, prompters and server settings are kept.')
      const r = await dialog.showMessageBox(win()!, {
        type: 'warning',
        title: 'Reset workspace',
        message: scope === 'all' ? 'Delete all projects and workflows?' : 'Delete all projects?',
        detail: detail.join('\n\n'),
        buttons: ['Cancel', scope === 'all' ? 'Delete projects and workflows' : 'Delete projects'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (r.response !== 1) return false
      refuseIfBusy() // a Run may have been queued while the dialog was open
      try {
        await ws().reset(scope, (dir) => shell.trashItem(dir))
      } finally {
        // Also after a failure part-way: the projects may be gone while the workflows are not.
        updateSettings({ currentProject: null })
        ctx.jobs.forgetFinished()
        ctx.emit({ type: 'workflows-changed' })
      }
      return true
    },
    async confirm(message, action) {
      const r = await dialog.showMessageBox(win()!, {
        type: 'warning',
        title: 'Comfy Director',
        message,
        buttons: ['Cancel', action],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      })
      return r.response === 1
    },
    async choose(message, actions) {
      const r = await dialog.showMessageBox(win()!, {
        type: 'warning',
        title: 'Comfy Director',
        message,
        buttons: ['Cancel', ...actions],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      })
      return r.response === 0 ? null : r.response - 1
    },
    async finishSetup() {
      updateSettings({ setupDone: true })
    },
    async syncedWarning(path) {
      const s = looksSynced(path)
      return s ? `This folder looks like it is synced by ${s}. SQLite files can be corrupted by sync tools; choose a folder outside it.` : null
    },

    /* ------------------------------------------------------ workflows */
    async listWorkflows() {
      return ws().listWorkflows(oi())
    },
    async pickWorkflowFile() {
      const r = await dialog.showOpenDialog(win()!, {
        title: 'Choose an API-format workflow',
        properties: ['openFile'],
        filters: [{ name: 'Workflow JSON', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePaths[0]) return null
      return { fileName: basename(r.filePaths[0]), text: readFileSync(r.filePaths[0], 'utf8') }
    },
    async analyzeWorkflow(fileName, text) {
      const base: ImportAnalysis = {
        ok: false, fileName, suggestedName: fileName.replace(/\.json$/i, '').replace(/^video_/, ''), nodeCount: 0,
        nodeTypeCount: 0, candidates: [], fields: [], seedFields: [], check: null, text, existingId: null
      }
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        return { ...base, error: 'This file is not valid JSON.' }
      }
      const fmt = detectFormat(data)
      if (fmt.format !== 'api') return { ...base, error: fmt.message }
      const d = discover(fmt.workflow, oi())
      const check = checkWorkflow(fmt.workflow, oi())
      const id = workflowIdFromName(base.suggestedName)
      return {
        ...base,
        ok: check.brokenLinks.length === 0,
        error: check.brokenLinks.length ? `${check.brokenLinks.length} link(s) point to missing nodes. Re-export the workflow.` : undefined,
        nodeCount: fmt.nodeCount,
        nodeTypeCount: fmt.nodeTypeCount,
        candidates: d.candidates,
        fields: d.fields,
        seedFields: d.seedTargets.map((s) => `${titleOf(fmt.workflow[s.nodeId])} · ${s.field}`),
        check,
        existingId: ws().app.workflow(id) ? id : null
      }
    },
    async previewImport(text, overrides, replaceId) {
      const fmt = detectFormat(JSON.parse(text))
      if (fmt.format !== 'api') throw new Error(fmt.message)
      const s = buildSchema(fmt.workflow, overrides, oi())
      let diff: ImportPreview['diff'] = null
      let previousVersion: number | null = null
      const removedInUse: ImportPreview['removedInUse'] = []
      const prev = replaceId ? ws().loadWorkflow(replaceId) : null
      if (prev) {
        previousVersion = prev.row.version
        diff = diffSchemas(buildSchema(prev.workflow, prev.overrides, oi()).inputs, s.inputs)
        for (const r of diff.removed) {
          let shots = 0
          for (const p of ws().projectPaths()) shots += ws().project(p).shotsUsingKey(r.key)
          if (shots) removedInUse.push({ key: r.key, shots })
        }
      }
      return {
        inputs: s.inputs,
        duplicateKeys: s.duplicateKeys,
        diff,
        previousVersion,
        nextVersion: (previousVersion ?? 0) + 1,
        hash: sha256(text).slice(0, 6),
        removedInUse
      }
    },
    async commitImport(c) {
      const id = ws().importWorkflow(c)
      ctx.emit({ type: 'workflows-changed' })
      return ws().info(ws().loadWorkflow(id)!, oi())
    },
    async getWorkflowOverrides(id) {
      return ws().loadWorkflow(id)?.overrides ?? {}
    },
    async getWorkflowFile(id) {
      const w = ws().loadWorkflow(id)
      return w ? { fileName: `workflows/${id}/workflow.json`, text: w.text } : null
    },
    async updateWorkflow(id, name, overrides) {
      ws().updateWorkflow(id, name, overrides)
      ctx.emit({ type: 'workflows-changed' })
      return ws().info(ws().loadWorkflow(id)!, oi())
    },
    async workflowShotCount(id) {
      let shots = 0
      for (const p of ws().projectPaths()) shots += ws().project(p).shotsUsingWorkflow(id)
      return shots
    },
    async deleteWorkflow(id) {
      if (!ws().app.workflow(id)) return
      const dir = ws().workflowDir(id)
      if (existsSync(dir)) await shell.trashItem(dir)
      ws().removeWorkflow(id)
      ctx.emit({ type: 'workflows-changed' })
    },

    /* ------------------------------------------------------- projects */
    async listProjects() {
      return ws().listProjects()
    },
    async createProject(name) {
      const p = ws().createProject(name)
      updateSettings({ currentProject: p.path })
      return p
    },
    async openProject(path) {
      const t = tree(path)
      updateSettings({ currentProject: resolve(path) })
      return t
    },
    async openExistingProject() {
      const r = await dialog.showOpenDialog(win()!, { title: 'Open a project folder', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      const p = ws().addExistingProject(r.filePaths[0])
      ctx.jobs.loadActive()
      return p
    },
    async renameProject(path, name) {
      if (ws().project(path).activeAttempts().length) throw new Error('Wait until this project has no queued or running jobs, then rename it.')
      const p = ws().renameProject(path, name)
      if (settings().currentProject && resolve(settings().currentProject!) === resolve(path)) updateSettings({ currentProject: p.path })
      return p
    },
    async removeProject(path) {
      ws().removeProject(path)
      if (settings().currentProject && resolve(settings().currentProject!) === resolve(path)) updateSettings({ currentProject: null })
    },
    async revealProject(path) {
      await shell.openPath(path)
    },
    async projectFolderPreview(name) {
      return { path: join(ws().projectsDir(), name.trim() || '…'), error: name.trim() ? ws().validateProjectName(name) : null }
    },
    async getProjectTree(path) {
      return tree(path)
    },

    /* ------------------------------------------------ sequences/shots */
    async createSequence(projectPath, name) {
      const s = ws().project(projectPath).createSequence(name.trim() || 'Untitled sequence')
      ctx.emit({ type: 'project-changed', projectPath })
      return s
    },
    async renameSequence(projectPath, id, name) {
      ws().project(projectPath).renameSequence(id, name.trim() || 'Untitled sequence')
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async deleteSequence(projectPath, id, deleteShots) {
      ws().project(projectPath).deleteSequence(id, deleteShots)
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async reorderShots(projectPath, sequenceId, shotIds) {
      ws().project(projectPath).reorder(sequenceId, shotIds)
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async createShot(projectPath, name, sequenceId, workflowId) {
      const s = ws().project(projectPath).createShot({ name: name.trim() || 'Untitled shot', sequenceId, workflowId })
      if (workflowId) ws().app.setMeta('last_workflow', workflowId)
      ctx.emit({ type: 'project-changed', projectPath })
      return s
    },
    async getShot(projectPath, shotId, attemptLimit = 20) {
      const pdb = ws().project(projectPath)
      const shot = pdb.shot(shotId)
      if (!shot) throw new Error('This shot no longer exists.')
      const attempts = pdb.attempts(shotId, attemptLimit).map((a) => {
        const p = ctx.jobs.progressOf(projectPath, a.id)
        return p !== null ? { ...a, progress: p } : a
      })
      const names = new Set<string>()
      const collect = (v: unknown): void => {
        if (typeof v === 'string' && /^[0-9a-f]{20}\.\w+$/.test(v)) names.add(v)
        if (Array.isArray(v)) v.forEach(collect)
      }
      Object.values(shot.values).forEach(collect)
      for (const a of attempts) Object.values(a.values).forEach(collect)
      const inputs = Object.fromEntries(pdb.inputs([...names]).map((i) => [i.name, i]))
      return {
        shot,
        sequence: shot.sequenceId !== null ? pdb.sequence(shot.sequenceId) : null,
        attempts,
        totalAttempts: pdb.attemptCount(shotId),
        inputs
      }
    },
    async updateShot(projectPath, shotId, patch) {
      const s = ws().project(projectPath).updateShot(shotId, patch)
      if (patch.name !== undefined || patch.keeperAttemptId !== undefined) ctx.emit({ type: 'project-changed', projectPath })
      if (patch.workflowId) ws().app.setMeta('last_workflow', patch.workflowId)
      return s
    },
    async duplicateShot(projectPath, shotId) {
      const pdb = ws().project(projectPath)
      const src = pdb.shot(shotId)
      if (!src) throw new Error('Shot not found.')
      const s = pdb.createShot({
        name: `${src.name} copy`,
        sequenceId: src.sequenceId,
        position: src.position !== null ? src.position + 1 : null,
        workflowId: src.workflowId,
        template: src
      })
      ctx.emit({ type: 'project-changed', projectPath })
      return s
    },
    async moveShot(projectPath, shotId, sequenceId, position) {
      ws().project(projectPath).moveShot(shotId, sequenceId, position)
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async deleteShot(projectPath, shotId) {
      ws().project(projectPath).deleteShot(shotId)
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async getSequenceShots(projectPath, sequenceId) {
      const pdb = ws().project(projectPath)
      const sequence = pdb.sequence(sequenceId)
      if (!sequence) throw new Error('Sequence not found.')
      return {
        sequence,
        shots: pdb.shotsInSequence(sequenceId).map((shot) => ({
          shot,
          keeper: shot.keeperAttemptId ? pdb.attempt(shot.keeperAttemptId) : null,
          attemptCount: pdb.attemptCount(shot.id)
        }))
      }
    },
    async exportKeepers(projectPath, sequenceId) {
      const pdb = ws().project(projectPath)
      const seq = pdb.sequence(sequenceId)
      if (!seq) throw new Error('Sequence not found.')
      const folder = join(projectPath, 'outputs', '_keepers', safeName(seq.name))
      rmSync(folder, { recursive: true, force: true })
      let count = 0
      for (const shot of pdb.shotsInSequence(sequenceId)) {
        const k = shot.keeperAttemptId ? pdb.attempt(shot.keeperAttemptId) : null
        const out = k?.outputs.find((o) => o.kind === 'video') ?? k?.outputs[0]
        if (!out || shot.position === null) continue
        const src = join(projectPath, out.path)
        if (!existsSync(src)) continue
        const dest = join(projectPath, keeperExportPath(seq.name, shot.position, shot.name, extOf(out.path)))
        mkdirSync(join(dest, '..'), { recursive: true })
        copyFileSync(src, dest)
        count++
      }
      if (count) await shell.openPath(folder)
      return { count, folder }
    },

    /* --------------------------------------------------------- inputs */
    async pickInputs(projectPath, multiple, media = 'image') {
      const kind = INPUT_FILES[media]
      const r = await dialog.showOpenDialog(win()!, {
        title: multiple ? kind.many : kind.one,
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [{ name: kind.filter, extensions: kind.extensions }]
      })
      if (r.canceled) return []
      return r.filePaths.map((p) => copyInput(projectPath, p))
    },
    async addInputFromPath(projectPath, filePath, media = 'image') {
      const kind = INPUT_FILES[media]
      if (!kind.extensions.includes(extOf(filePath))) throw new Error(kind.error)
      return copyInput(projectPath, filePath)
    },

    /* ------------------------------------------------------- attempts */
    async run(projectPath, shotId, req) {
      return ctx.jobs.run(projectPath, shotId, req)
    },
    async retryAttempt(projectPath, attemptId, newSeed) {
      return ctx.jobs.retry(projectPath, attemptId, newSeed)
    },
    async setKeeper(projectPath, shotId, attemptId) {
      ws().project(projectPath).updateShot(shotId, { keeperAttemptId: attemptId })
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async deleteAttempt(projectPath, attemptId) {
      const pdb = ws().project(projectPath)
      const a = pdb.attempt(attemptId)
      if (a && (a.status === 'queued' || a.status === 'running')) throw new Error('Cancel the attempt before deleting it.')
      pdb.deleteAttempt(attemptId)
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async getAttempts(projectPath, ids) {
      const pdb = ws().project(projectPath)
      return ids.map((id) => pdb.attempt(id)).filter((a): a is NonNullable<typeof a> => !!a)
    },
    async cancelAttempt(projectPath, attemptId) {
      await ctx.jobs.cancelAttempt(projectPath, attemptId)
    },
    async revealFile(projectPath, relPath) {
      shell.showItemInFolder(join(projectPath, relPath))
    },
    async saveThumbnail(projectPath, attemptId, base64, duration) {
      const rel = `thumbs/attempt-${attemptId}.jpg`
      mkdirSync(join(projectPath, 'thumbs'), { recursive: true })
      writeFileSync(join(projectPath, rel), Buffer.from(base64, 'base64'))
      const a = ws().project(projectPath).updateAttempt(attemptId, { thumb: rel, mediaDuration: duration })
      if (a) ctx.emit({ type: 'attempt', projectPath, attempt: a })
    },
    async pendingThumbnails() {
      const out: ThumbnailJob[] = []
      for (const p of ws().projectPaths()) {
        for (const a of ws().project(p).attemptsMissingThumb()) {
          const m = a.outputs.find((o) => o.kind === 'video') ?? a.outputs.find((o) => o.kind === 'image')
          if (m && existsSync(join(p, m.path))) out.push({ projectPath: p, attemptId: a.id, file: m.path, kind: m.kind })
        }
      }
      return out
    },

    /* ---------------------------------------------------------- queue */
    async getQueue() {
      return ctx.jobs.snapshot()
    },
    async cancelJobs(ids) {
      await ctx.jobs.cancelJobs(ids)
    },
    async cancelOtherClientJob(id) {
      await ctx.jobs.cancelOtherClientJob(id)
    },
    async interrupt(id) {
      await ctx.jobs.interrupt(id)
    },
    async cancelAllWaiting() {
      return ctx.jobs.cancelAllWaiting()
    },
    async takeReconcileSummary() {
      return ctx.jobs.takeSummary()
    },

    /* -------------------------------------------------------- gallery */
    async gallery(f: GalleryFilter) {
      const current = settings().currentProject
      const paths = f.project === 'all' ? ws().projectPaths() : current ? [resolve(current)] : []
      let items: GalleryItem[] = []
      for (const p of paths) {
        const pdb = ws().project(p)
        const seqs = new Map(pdb.sequences().map((s) => [s.id, s]))
        const counts = new Map<number, number>()
        const rows = pdb.galleryAttempts()
        for (const r of rows) counts.set(r.shotId, (counts.get(r.shotId) ?? 0) + 1)
        const name = ws().projectName(p)
        for (const r of rows) {
          const { shotName, shotPosition, sequenceId, keeper, ...attempt } = r
          items.push({
            projectPath: p, projectName: name, attempt, shotName, shotPosition, sequenceId,
            sequenceName: sequenceId !== null ? seqs.get(sequenceId)?.name ?? null : null,
            isKeeper: keeper === attempt.id, shotAttemptCount: counts.get(r.shotId) ?? 0
          })
        }
      }
      const q = f.search.trim().toLowerCase()
      items = items.filter((i) => {
        if (f.keepersOnly && !i.isKeeper) return false
        if (f.workflowId && i.attempt.workflowId !== f.workflowId) return false
        if (f.sequence === 'loose' && i.sequenceId !== null) return false
        if (typeof f.sequence === 'number' && i.sequenceId !== f.sequence) return false
        if (q && !String(i.attempt.values.prompt ?? '').toLowerCase().includes(q)) return false
        return true
      })
      const t = (i: GalleryItem): number => Date.parse(i.attempt.finishedAt ?? i.attempt.createdAt)
      if (f.groupBy === 'shot') {
        const latest = new Map<string, number>()
        for (const i of items) {
          const k = `${i.projectPath}#${i.attempt.shotId}`
          latest.set(k, Math.max(latest.get(k) ?? 0, t(i)))
        }
        items.sort((a, b) => {
          const ka = `${a.projectPath}#${a.attempt.shotId}`
          const kb = `${b.projectPath}#${b.attempt.shotId}`
          return ka === kb ? t(b) - t(a) : latest.get(kb)! - latest.get(ka)! || (ka < kb ? -1 : 1)
        })
      } else items.sort((a, b) => t(b) - t(a))
      return { items: items.slice(f.offset, f.offset + f.limit), hasMore: f.offset + f.limit < items.length, total: items.length }
    },

    /* -------------------------------------------------------- library */
    async listPrompts() {
      return ws().app.prompts()
    },
    async savePrompt(p) {
      return ws().app.savePrompt(p)
    },
    async deletePrompt(id) {
      ws().app.deletePrompt(id)
    },
    async usePrompt(id, projectPath, shotId, mode) {
      const p = ws().app.prompt(id)
      const pdb = ws().project(projectPath)
      const shot = pdb.shot(shotId)
      if (!p || !shot) throw new Error('Prompt or shot not found.')
      if (mode === 'replace') pdb.updateShot(shotId, { values: { ...shot.values, prompt: p.text } })
      else {
        const list = shot.promptMode === 'list' ? shot.promptList : [String(shot.values.prompt ?? '')].filter(Boolean)
        pdb.updateShot(shotId, { promptMode: 'list', promptList: [...list, p.text] })
      }
      ws().app.markPromptUsed(id, shot.name)
      ctx.emit({ type: 'project-changed', projectPath })
    },
    async markPromptsUsed(ids, where) {
      for (const id of ids) ws().app.markPromptUsed(id, where)
    },
    async listPrompters() {
      return ws().app.prompters()
    },
    async savePrompter(p) {
      return ws().app.savePrompter(p)
    },
    async deletePrompter(id) {
      ws().app.deletePrompter(id)
    },
    async generatePrompts(config, opts) {
      const seed = opts.seed ?? (config.type === 'template' ? config.template.seed : randomSeed())
      const skill = config.type === 'llm' ? skillText(config.llm) : null
      return createPrompter(config, skill).generate({ count: opts.count, seed, currentPrompt: opts.currentPrompt, ideas: opts.ideas })
    },
    async pickScriptFile() {
      const r = await dialog.showOpenDialog(win()!, {
        title: 'Choose a prompter script',
        properties: ['openFile'],
        filters: [{ name: 'Scripts', extensions: ['py', 'js', 'mjs', 'cjs'] }, { name: 'All files', extensions: ['*'] }]
      })
      return r.canceled ? null : r.filePaths[0] ?? null
    },
    async listSkills() {
      return ws().listSkills()
    },
    async addSkill(type) {
      if (!type.trim()) throw new Error('Enter a workflow type.')
      const r = await dialog.showOpenDialog(win()!, {
        title: 'Choose a skill file',
        properties: ['openFile'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }, { name: 'All files', extensions: ['*'] }]
      })
      if (r.canceled || !r.filePaths[0]) return null
      return ws().saveSkill(type, r.filePaths[0])
    },
    async revealSkill(type) {
      const s = ws().skill(type)
      if (s) shell.showItemInFolder(s.info.path)
    },
    async deleteSkill(type) {
      const dir = ws().skillDir(type)
      if (existsSync(dir)) await shell.trashItem(dir)
    },

    /* ---------------------------------------------------- prompt chat */
    async getChat(projectPath, shotId) {
      return shotChat(projectPath, shotId)
    },
    async sendChat(projectPath, shotId, prompterId, message) {
      const pdb = ws().project(projectPath)
      if (!pdb.shot(shotId)) throw new Error('This shot no longer exists.')
      const prompter = ws().app.prompter(prompterId)
      if (!prompter || prompter.config.type !== 'llm') throw new Error('Choose an LLM prompter for the chat.')
      const skill = skillText(prompter.config.llm)
      const key = chatKey(projectPath, shotId)
      if (chatsInFlight.has(key)) throw new Error('A reply is still being written for this shot.')
      if (message) {
        if (!message.text.trim() && !message.images.length) throw new Error('Write a message first.')
        pdb.addChatMessage(shotId, 'user', message.text.trim(), message.images)
      }
      const history = pdb.chat(shotId)
      if (history[history.length - 1]?.role !== 'user') throw new Error('There is no message waiting for a reply.')
      // Images are numbered across the whole chat, so "Image 3" means the same picture in every turn.
      let n = 0
      const turns: ChatTurn[] = history.map((m) => {
        if (!m.images.length) return { role: m.role, content: m.text }
        const parts: ChatPart[] = []
        for (const name of m.images) {
          const file = join(projectPath, 'inputs', name)
          n++
          if (!existsSync(file)) {
            parts.push({ type: 'text', text: `Image ${n}: (file no longer available)` })
            continue
          }
          parts.push({ type: 'text', text: `Image ${n}:` }, { type: 'image_url', image_url: { url: imageDataUrl(file) } })
        }
        if (m.text) parts.push({ type: 'text', text: m.text })
        return { role: m.role, content: parts }
      })
      const abort = new AbortController()
      chatsInFlight.set(key, abort)
      try {
        const reply = await new LlmPrompter(prompter.config.llm, skill).chat(turns, {
          signal: abort.signal,
          onDelta: (delta) => ctx.emit({ type: 'chat-delta', projectPath, shotId, delta })
        })
        // Stopped before anything arrived: nothing to keep, and the message still waits for a reply.
        if (reply) pdb.addChatMessage(shotId, 'assistant', reply)
      } catch (e) {
        if (!abort.signal.aborted) throw e
      } finally {
        chatsInFlight.delete(key)
      }
      return shotChat(projectPath, shotId)
    },
    async stopChat(projectPath, shotId) {
      chatsInFlight.get(chatKey(projectPath, shotId))?.abort()
    },
    async clearChat(projectPath, shotId) {
      ws().project(projectPath).clearChat(shotId)
    },

    /* --------------------------------------------------- server files */
    async listServerFiles(folder) {
      try {
        return { installed: true, files: await serverClient().listFiles(folder) }
      } catch (e) {
        if (e instanceof ComfyError && e.notInstalled) return { installed: false, files: [] }
        throw e
      }
    },
    async deleteServerFiles(files) {
      const refs = files.filter((f) => SERVER_FOLDERS.includes(f.type))
      if (!refs.length) return { deleted: 0, errors: [] }
      // Taken before the request: the server or workspace in Settings can change while it is pending.
      const client = serverClient()
      const server = ctx.server.url_
      const workspace = ws()
      const res = await client.deleteFiles(refs)
      // A deleted ref must be uploaded again by the next Run that uses it, in whichever project.
      const inputs = res.deleted.filter((f) => f.type === 'input').map(serverFilePath)
      if (inputs.length) {
        for (const p of workspace.app.projects()) {
          try {
            const pdb = workspace.project(p.path)
            for (const name of inputs) pdb.forgetServerFile(server, name)
          } catch {
            /* project folder missing */
          }
        }
      }
      return { deleted: res.deleted.length, errors: res.errors.map((e) => `${serverFilePath(e)}: ${e.message}`) }
    },
    async revealServerNode() {
      const dir = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'comfyui-node')
      const err = await shell.openPath(dir)
      if (err) throw new Error(`Can't open ${dir}: ${err}`)
    },

    /* ----------------------------------------------------------- misc */
    async mediaUrl(absPath) {
      return mediaUrlFor(absPath)
    },
    async copyText(text) {
      clipboard.writeText(text)
    }
  }
  return api
}
