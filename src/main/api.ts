import { BrowserWindow, clipboard, dialog, nativeTheme, shell } from 'electron'
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
  AppEvent, GalleryFilter, GalleryItem, ImportAnalysis, ImportPreview, InputFile, ProjectTree, ThumbnailJob
} from '@shared/types'
import { detectFormat } from '@core/workflow/format'
import { discover } from '@core/workflow/discover'
import { buildSchema } from '@core/workflow/schema'
import { checkWorkflow } from '@core/workflow/check'
import { diffSchemas } from '@core/workflow/reconcile'
import { keeperExportPath, extOf, looksSynced, safeName } from '@core/output/naming'
import { createPrompter } from '@core/prompter'
import { randomSeed } from '@core/planner'
import { titleOf } from '@core/workflow/graph'

export interface Context {
  ws: () => Workspace
  setWorkspace: (w: Workspace) => void
  server: ServerManager
  jobs: JobManager
  emit: (e: AppEvent) => void
  window: () => BrowserWindow | null
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp']

export function createApi(ctx: Context): ToolkitApi {
  const ws = ctx.ws
  const oi = (): ReturnType<() => ServerManager['objectInfo']> => ctx.server.objectInfo
  const win = (): BrowserWindow | undefined => ctx.window() ?? undefined

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
    async deleteSequence(projectPath, id) {
      ws().project(projectPath).deleteSequence(id)
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
    async pickImages(projectPath, multiple) {
      const r = await dialog.showOpenDialog(win()!, {
        title: multiple ? 'Choose images' : 'Choose an image',
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [{ name: 'Images', extensions: IMAGE_EXT }]
      })
      if (r.canceled) return []
      return r.filePaths.map((p) => copyInput(projectPath, p))
    },
    async addInputFromPath(projectPath, filePath) {
      if (!IMAGE_EXT.includes(extOf(filePath))) throw new Error('Only PNG, JPG, WEBP and BMP images can be used.')
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
      return createPrompter(config).generate({ count: opts.count, seed, currentPrompt: opts.currentPrompt, ideas: opts.ideas })
    },
    async pickScriptFile() {
      const r = await dialog.showOpenDialog(win()!, {
        title: 'Choose a prompter script',
        properties: ['openFile'],
        filters: [{ name: 'Scripts', extensions: ['py', 'js', 'mjs', 'cjs'] }, { name: 'All files', extensions: ['*'] }]
      })
      return r.canceled ? null : r.filePaths[0] ?? null
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
