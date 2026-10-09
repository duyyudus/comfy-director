import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Workspace } from './workspace'
import type { ServerManager } from './server'
import type { ProjectDb } from './db'
import { now } from './db'
import { ComfyError, describeExecutionError, historyFiles, type HistoryEntry, type PromptRejection, type QueueEntry, type QueueState, type WsMessage } from '@core/comfy/client'
import { applyValues, fileValues } from '@core/workflow/apply'
import { buildSchema } from '@core/workflow/schema'
import { validateValues } from '@core/workflow/validate'
import type { SchemaInput, WorkflowSchema } from '@core/workflow/types'
import { planRun } from '@core/planner'
import { attemptFileName, extOf, freeFileName, mediaKind, shotOutputDir } from '@core/output/naming'
import type {
  AppEvent, Attempt, AttemptError, FinishedJob, OutputFile, QueueJob, QueueSnapshot, ReconcileSummary, RunRequest, RunResult
} from '@shared/types'

interface ActiveJob {
  projectPath: string
  attemptId: number
  shotId: number
  shotName: string
  attemptNum: number
  workflowName: string
  runId: string
  promptIndex: number
  promptCount: number
  runIndex: number
  runCount: number
  seedNote: string
  nodeCount: number
}

interface LiveState {
  percent: number
  stage: string
  cachedNodes: Set<string>
  executed: number
  sawProgress: boolean
  progressDone: boolean
  startedAt: string | null
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4'
}

export class JobManager {
  private active = new Map<string, ActiveJob>()
  private live = new Map<string, LiveState>()
  private orphans = new Map<string, { at: number; msgs: WsMessage[] }>()
  private queue: QueueState = { queue_running: [], queue_pending: [] }
  private finished: FinishedJob[] = []
  private queueTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private reconcileTimer: NodeJS.Timeout | null = null
  private finalizing = new Set<string>()
  private downloadTries = new Map<string, number>()
  /** Kept until the renderer collects it: reconcile can finish before the window listens. */
  private lastSummary: ReconcileSummary | null = null

  takeSummary(): ReconcileSummary | null {
    const s = this.lastSummary
    this.lastSummary = null
    return s
  }

  constructor(
    private ws: () => Workspace,
    private server: ServerManager,
    private emit: (e: AppEvent) => void
  ) {
    server.on('message', (m: WsMessage) => this.onMessage(m))
    server.on('connected', () => {
      void this.reconcile()
      this.startPolling()
    })
    server.on('disconnected', () => this.stopPolling())
  }

  /** Drops the finished list, whose entries point at projects that a workspace reset removed. */
  forgetFinished(): void {
    this.finished = []
    this.emitQueue()
  }

  /* --------------------------------------------------------------- loading */

  /** Rebuilds the in-memory list of active jobs from every project's database. */
  loadActive(): void {
    const ws = this.ws()
    for (const path of ws.projectPaths()) {
      let pdb: ProjectDb
      try {
        pdb = ws.project(path)
      } catch {
        continue
      }
      for (const a of pdb.activeAttempts()) {
        if (a.status === 'submitting' && !a.promptId) {
          pdb.deleteAttempt(a.id)
          continue
        }
        if (a.promptId) this.register(a.promptId, this.jobInfo(path, pdb, a, null))
      }
    }
  }

  private jobInfo(projectPath: string, pdb: ProjectDb, a: Attempt, seedMode: string | null): ActiveJob {
    const shot = pdb.shot(a.shotId)
    let nodeCount = 0
    try {
      nodeCount = Object.keys(JSON.parse(pdb.finalJson(a.id) ?? '{}')).length
    } catch {
      /* ignore */
    }
    return {
      projectPath: resolve(projectPath),
      attemptId: a.id,
      shotId: a.shotId,
      shotName: shot?.name ?? 'Shot',
      attemptNum: a.num,
      workflowName: a.workflowName,
      runId: a.runId,
      promptIndex: a.promptIndex,
      promptCount: a.promptCount,
      runIndex: a.runIndex,
      runCount: a.runCount,
      seedNote: seedMode ? `seed ${seedMode}` : `seed …${String(a.seed).slice(-4)}`,
      nodeCount
    }
  }

  private register(promptId: string, job: ActiveJob): void {
    this.active.set(promptId, job)
    const o = this.orphans.get(promptId)
    if (o) {
      this.orphans.delete(promptId)
      for (const m of o.msgs) this.onMessage(m)
    }
  }

  /* ------------------------------------------------------------------- run */

  async run(projectPath: string, shotId: number, req: RunRequest, reuploaded = false): Promise<RunResult> {
    const client = this.server.client
    if (!client || !this.server.connected) return { ok: false, message: "Can't reach the server. Nothing was queued." }
    const ws = this.ws()
    const pdb = ws.project(projectPath)
    const shot = pdb.shot(shotId)
    if (!shot) return { ok: false, message: 'This shot no longer exists.' }
    const loaded = ws.loadWorkflow(req.workflowId)
    if (!loaded) return { ok: false, message: 'The workflow file is missing or unreadable.' }
    const schema = buildSchema(loaded.workflow, loaded.overrides, this.server.objectInfo)
    if (schema.duplicateKeys.length) {
      return { ok: false, message: `Two inputs share the key "${schema.duplicateKeys[0]}". Rename one in Import workflow.` }
    }

    const listMode = req.promptMode === 'list'
    const prompts = listMode ? req.prompts.map((p) => p.trim()).filter(Boolean) : null
    const hasPrompt = schema.inputs.some((i) => i.key === 'prompt')
    const fieldErrors = validateValues(schema.inputs, req.values)
    if (listMode) {
      delete fieldErrors.prompt
      if (!hasPrompt) return { ok: false, message: 'This workflow has no prompt input, so list mode cannot be used.' }
      if (!prompts!.length) fieldErrors.prompt = 'Add at least one prompt.'
    }
    if (req.seedMode === 'fixed' && (req.seedValue === null || !Number.isFinite(req.seedValue) || req.seedValue < 0)) {
      fieldErrors.__seed = 'Enter a seed (a whole number, 0 or more).'
    }
    if (Object.keys(fieldErrors).length) {
      const n = Object.keys(fieldErrors).length
      return { ok: false, fieldErrors, message: `${n} problem${n === 1 ? '' : 's'} to fix before running. Nothing was queued.` }
    }

    // Upload input files not yet on this server. One failure stops the run.
    const server = this.server.url_
    const failures: RunResult['uploadFailures'] = []
    const remembered: string[] = []
    for (const file of fileValues(schema, req.values)) {
      if (pdb.uploadedName(file, server)) {
        remembered.push(file)
        continue
      }
      try {
        const data = readFileSync(join(projectPath, 'inputs', file))
        const res = await client.uploadImage(file, data, MIME[extOf(file)] ?? 'application/octet-stream')
        pdb.markUploaded(file, server, res.subfolder ? `${res.subfolder}/${res.name}` : res.name)
      } catch (e) {
        failures.push({ key: keyForFile(schema.inputs, req.values, file), file, message: (e as Error).message })
        break
      }
    }
    if (failures.length) return { ok: false, uploadFailures: failures, message: 'A file failed to upload. Nothing was queued.' }

    const jobs = planRun({ prompts, runs: req.runs, seedMode: req.seedMode, fixedSeed: req.seedValue })
    const runId = randomUUID()
    const created: Attempt[] = []
    const submitted = new Map<string, Attempt>()
    const firstNum = (pdb.db.prepare('SELECT next_attempt_num AS n FROM shots WHERE id=?').get(shotId) as { n: number }).n
    // Recorded with each attempt, so it still reads the same if a default is changed later.
    const usedDefaults: Record<string, unknown> = {}
    for (const i of schema.inputs) {
      if (!(i.key in req.values) && i.type !== 'file' && i.type !== 'file-group') usedDefaults[i.key] = i.default
    }
    try {
      for (const job of jobs) {
        const values = { ...req.values }
        if (job.prompt !== null) values.prompt = job.prompt
        const final = applyValues(loaded.workflow, schema, values, {
          seed: job.seed,
          serverName: (f) => pdb.uploadedName(f, server) ?? f
        })
        const attempt = pdb.createAttempt({
          shotId,
          workflowId: loaded.row.id,
          workflowName: loaded.row.name,
          workflowVersion: loaded.row.version,
          workflowHash: loaded.row.hash,
          values: { ...usedDefaults, ...(listMode ? values : req.values) },
          seed: job.seed,
          runId,
          promptIndex: job.promptIndex,
          promptCount: job.promptCount,
          runIndex: job.runIndex,
          runCount: Math.max(1, Math.floor(req.runs || 1)),
          finalJson: JSON.stringify(final),
          serverUrl: server
        })
        created.push(attempt)
        const res = await client.queuePrompt(final)
        submitted.set(res.prompt_id, attempt)
        this.register(res.prompt_id, this.jobInfo(projectPath, pdb, attempt, req.seedMode))
        pdb.updateAttempt(attempt.id, { status: 'queued', promptId: res.prompt_id })
      }
    } catch (e) {
      // Roll back: nothing half-queued is left behind, unless the server would not take a job back.
      const left = await this.rollback([...submitted.keys()])
      const kept = [...submitted].filter(([pid]) => left.has(pid)).map(([, a]) => a)
      for (const a of created) if (!kept.includes(a)) pdb.deleteAttempt(a.id)
      const nextNum = kept.length ? Math.max(...kept.map((a) => a.num)) + 1 : firstNum
      pdb.db.prepare('UPDATE shots SET next_attempt_num=? WHERE id=?').run(nextNum, shotId)
      if (kept.length) this.emit({ type: 'project-changed', projectPath })
      const outcome = kept.length
        ? `${kept.length} job${kept.length === 1 ? '' : 's'} already queued could not be removed and will still run.`
        : 'Nothing was queued.'
      if (e instanceof ComfyError && e.body && typeof e.body === 'object' && 'node_errors' in (e.body as object)) {
        const { fieldErrors: fe, general } = mapRejection(schema, e.body as PromptRejection)
        // The server may have lost a file this app remembers uploading: upload again and try once more.
        const onFile = schema.inputs.some((i) => i.key in fe && (i.type === 'file' || i.type === 'file-group'))
        if (onFile && remembered.length && !reuploaded && !kept.length) {
          for (const file of remembered) pdb.forgetUpload(file, server)
          return this.run(projectPath, shotId, req, true)
        }
        const n = Object.keys(fe).length + (general.length ? 1 : 0)
        return {
          ok: false,
          fieldErrors: fe,
          message: `The server rejected the job${general.length ? `: ${general.join(' ')}` : '.'} ${n} problem${n === 1 ? '' : 's'} remain. ${outcome}`
        }
      }
      return { ok: false, message: `${(e as Error).message} ${outcome}` }
    }

    pdb.updateShot(shotId, { lastSeed: jobs[jobs.length - 1].seed })
    this.emit({ type: 'project-changed', projectPath })
    this.refreshQueueSoon(50)
    return { ok: true, attempts: created.map((a) => pdb.attempt(a.id)!) }
  }

  /** Takes back jobs of a Run that failed part-way. Returns the ids that are still on the server. */
  private async rollback(promptIds: string[]): Promise<Set<string>> {
    const left = new Set<string>()
    if (!promptIds.length) return left
    try {
      const client = this.server.client
      if (!client) throw new Error('offline')
      const q = await client.getQueue()
      const running = q.queue_running.map((e) => e[1]).filter((id) => promptIds.includes(id))
      await client.deleteQueued(promptIds.filter((id) => !running.includes(id)))
      for (const id of running) await client.interrupt(id)
      const waiting = new Set((await client.getQueue()).queue_pending.map((e) => e[1]))
      for (const id of promptIds) if (waiting.has(id)) left.add(id)
    } catch {
      // Unknown: keep tracking them. The queue poll settles any that did go away.
      for (const id of promptIds) left.add(id)
    }
    for (const id of promptIds) if (!left.has(id)) this.active.delete(id)
    return left
  }

  /** Re-runs an attempt's workflow and values. `newSeed` picks a random seed, otherwise the same seed is kept. */
  async retry(projectPath: string, attemptId: number, newSeed: boolean): Promise<RunResult> {
    const pdb = this.ws().project(projectPath)
    const a = pdb.attempt(attemptId)
    if (!a) return { ok: false, message: 'Attempt not found.' }
    return this.run(projectPath, a.shotId, {
      workflowId: a.workflowId,
      values: a.values,
      promptMode: 'single',
      prompts: [],
      runs: 1,
      seedMode: newSeed ? 'random' : 'fixed',
      seedValue: newSeed ? null : a.seed
    })
  }

  /* ------------------------------------------------------------ websocket */

  private onMessage(m: WsMessage): void {
    const pid = typeof m.data?.prompt_id === 'string' ? m.data.prompt_id : null
    if (m.type === 'status') {
      this.refreshQueueSoon()
      return
    }
    if (!pid) return
    const job = this.active.get(pid)
    if (!job) {
      // Can arrive before the POST /prompt answer is processed: keep it briefly.
      const o = this.orphans.get(pid) ?? { at: Date.now(), msgs: [] }
      if (o.msgs.length < 200) o.msgs.push(m)
      this.orphans.set(pid, o)
      for (const [k, v] of this.orphans) if (Date.now() - v.at > 120_000) this.orphans.delete(k)
      return
    }
    const live = this.liveOf(pid)
    switch (m.type) {
      case 'execution_start': {
        live.startedAt = now()
        live.stage = 'Starting'
        this.update(job, { status: 'running', startedAt: live.startedAt })
        this.refreshQueueSoon(50)
        break
      }
      case 'execution_cached': {
        for (const n of (m.data.nodes as string[]) ?? []) live.cachedNodes.add(String(n))
        break
      }
      case 'executing': {
        const node = m.data.node as string | null
        if (node === null || node === undefined) {
          // Older servers signal completion with executing: null.
          if (!this.finalizing.has(pid)) void this.finalize(pid)
          break
        }
        if (live.sawProgress) live.progressDone = true
        live.executed++
        const title = this.nodeTitle(job, String(node))
        live.stage = `Running ${title}`
        const total = Math.max(1, job.nodeCount - live.cachedNodes.size)
        live.percent = Math.max(live.percent, live.progressDone ? 96 : Math.round(Math.min(5, (live.executed / total) * 5)))
        this.emitQueueSoon()
        break
      }
      case 'progress': {
        const value = Number(m.data.value ?? 0)
        const max = Math.max(1, Number(m.data.max ?? 1))
        live.sawProgress = true
        live.progressDone = false
        const node = String(m.data.node ?? '')
        const cls = this.nodeClass(job, node)
        live.stage = /sampler/i.test(cls) || !cls ? `Sampling, step ${value} of ${max}` : `${this.nodeTitle(job, node)}, ${value} of ${max}`
        live.percent = Math.max(live.percent, Math.round(5 + (90 * value) / max))
        this.emitQueueSoon()
        break
      }
      case 'execution_success':
        if (!this.finalizing.has(pid)) void this.finalize(pid)
        break
      case 'execution_error': {
        const d = describeExecutionError(m.data)
        this.fail(pid, job, { message: d.message, nodeId: d.nodeId, nodeType: d.nodeType, errorType: d.errorType, details: d.details, stoppedAt: live.percent }, 'failed')
        break
      }
      case 'execution_interrupted': {
        const pct = Math.round(live.percent)
        this.fail(pid, job, { message: `Stopped at ${pct}%. No video was saved.`, stoppedAt: pct }, 'cancelled')
        break
      }
    }
  }

  private liveOf(pid: string): LiveState {
    let l = this.live.get(pid)
    if (!l) {
      l = { percent: 0, stage: 'Waiting', cachedNodes: new Set(), executed: 0, sawProgress: false, progressDone: false, startedAt: null }
      this.live.set(pid, l)
    }
    return l
  }

  private finalCache = new Map<number, Record<string, { class_type: string; _meta?: { title?: string } }>>()
  private finalOf(job: ActiveJob): Record<string, { class_type: string; _meta?: { title?: string } }> {
    let f = this.finalCache.get(job.attemptId)
    if (!f) {
      try {
        f = JSON.parse(this.ws().project(job.projectPath).finalJson(job.attemptId) ?? '{}')
      } catch {
        f = {}
      }
      this.finalCache.set(job.attemptId, f!)
    }
    return f!
  }
  private nodeClass(job: ActiveJob, node: string): string {
    return this.finalOf(job)[node]?.class_type ?? ''
  }
  private nodeTitle(job: ActiveJob, node: string): string {
    const n = this.finalOf(job)[node]
    return n?._meta?.title || n?.class_type || `node ${node}`
  }

  private update(job: ActiveJob, patch: Parameters<ProjectDb['updateAttempt']>[1]): Attempt | null {
    try {
      const a = this.ws().project(job.projectPath).updateAttempt(job.attemptId, patch)
      if (a) this.emit({ type: 'attempt', projectPath: job.projectPath, attempt: a })
      return a
    } catch {
      return null
    }
  }

  private fail(pid: string, job: ActiveJob, error: AttemptError, status: 'failed' | 'cancelled'): void {
    const a = this.update(job, { status, error, progress: error.stoppedAt ?? 0, finishedAt: now() })
    this.done(pid, job, status, status === 'failed' ? error.message : `stopped at ${error.stoppedAt ?? 0}%`, a?.error ?? error)
  }

  private done(pid: string, job: ActiveJob, status: FinishedJob['status'], note: string, error?: AttemptError | null): FinishedJob {
    const f: FinishedJob = {
      status,
      projectPath: job.projectPath,
      shotId: job.shotId,
      shotName: job.shotName,
      attemptId: job.attemptId,
      attemptNum: job.attemptNum,
      workflowName: job.workflowName,
      finishedAt: now(),
      note,
      error: error ?? null
    }
    this.finished.unshift(f)
    this.finished = this.finished.slice(0, 50)
    this.active.delete(pid)
    this.live.delete(pid)
    this.downloadTries.delete(pid)
    this.finalCache.delete(job.attemptId)
    this.emit({ type: 'project-changed', projectPath: job.projectPath })
    this.refreshQueueSoon(50)
    return f
  }

  /** Downloads the outputs of a successful job into the project folder. */
  private async finalize(pid: string, history?: HistoryEntry | null): Promise<FinishedJob | null> {
    const job = this.active.get(pid)
    const client = this.server.client
    if (!job || !client || this.finalizing.has(pid)) return null
    this.finalizing.add(pid)
    try {
      let h = history ?? null
      for (let i = 0; !h && i < 5; i++) {
        h = await client.getHistory(pid)
        if (!h) await new Promise((r) => setTimeout(r, 500 * (i + 1)))
      }
      if (!h) throw new Error('The server finished the job but has no history for it.')
      if (h.status?.status_str === 'error') {
        const err = (h.status.messages ?? []).find(([t]) => t === 'execution_error')
        const d = describeExecutionError(err?.[1] ?? {})
        this.fail(pid, job, { message: d.message, nodeId: d.nodeId, nodeType: d.nodeType, errorType: d.errorType, details: d.details }, 'failed')
        return this.finished[0]
      }
      const live = this.liveOf(pid)
      for (const [t, d] of h.status?.messages ?? []) {
        if (t === 'execution_cached') for (const n of (d.nodes as string[]) ?? []) live.cachedNodes.add(String(n))
      }
      const pdb = this.ws().project(job.projectPath)
      const attempt = pdb.attempt(job.attemptId)
      const shot = pdb.shot(job.shotId)
      if (!attempt || !shot) throw new Error('The attempt was deleted.')
      const seq = shot.sequenceId !== null ? pdb.sequence(shot.sequenceId) : null
      const dir = shotOutputDir(shot, seq?.name ?? null)
      mkdirSync(join(job.projectPath, dir), { recursive: true })
      const files = historyFiles(h).sort((a, b) => rank(a.filename) - rank(b.filename))
      // Fetch everything before writing, so a retry after a failed download leaves no partial set behind.
      const blobs: Buffer[] = []
      for (const f of files) blobs.push(Buffer.from(await client.view(f)))
      const outputs: OutputFile[] = []
      for (const [i, f] of files.entries()) {
        const data = blobs[i]
        const name = freeFileName(attemptFileName(attempt.id, attempt.workflowName, extOf(f.filename) || 'bin', i), (n) => existsSync(join(job.projectPath, dir, n)))
        const rel = `${dir}/${name}`
        writeFileSync(join(job.projectPath, rel), data)
        outputs.push({ path: rel, kind: mediaKind(f.filename), filename: f.filename })
      }
      const outputNodes = Object.keys(h.outputs ?? {})
      const cached = outputNodes.length > 0 && outputNodes.every((n) => live.cachedNodes.has(n))
      const status = cached ? 'cached' : 'done'
      const startedAt = attempt.startedAt ?? live.startedAt
      this.update(job, { status, outputs, progress: 100, finishedAt: now(), error: null, startedAt })
      const media = outputs.find((o) => o.kind === 'video') ?? outputs.find((o) => o.kind === 'image')
      if (media) this.emit({ type: 'thumbnail', job: { projectPath: job.projectPath, attemptId: job.attemptId, file: media.path, kind: media.kind } })
      const secs = startedAt ? Math.round((Date.now() - Date.parse(startedAt)) / 1000) : null
      const note = cached
        ? 'server reused an earlier result'
        : outputs.length
          ? secs !== null ? `rendered in ${formatSecs(secs)}` : 'rendered'
          : 'finished, no output files'
      return this.done(pid, job, status, note)
    } catch (e) {
      // The result is still on the server: a request that failed is tried again before giving up.
      const tries = (this.downloadTries.get(pid) ?? 0) + 1
      if (e instanceof ComfyError && tries < 3) {
        this.downloadTries.set(pid, tries)
        this.reconcileSoon()
        return null
      }
      this.fail(pid, job, { message: `Finished on the server, but the download failed: ${(e as Error).message}` }, 'failed')
      return this.finished[0]
    } finally {
      this.finalizing.delete(pid)
    }
  }

  /* ---------------------------------------------------------------- queue */

  private startPolling(): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => void this.refreshQueue(), 4000)
    void this.refreshQueue()
  }
  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  refreshQueueSoon(ms = 300): void {
    if (this.queueTimer) return
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null
      void this.refreshQueue()
    }, ms)
  }

  async refreshQueue(): Promise<void> {
    const client = this.server.client
    if (!client || !this.server.connected) return
    try {
      this.queue = await client.getQueue()
    } catch {
      return
    }
    // Jobs that left the queue without an event (e.g. removed by another client).
    const inQueue = new Set([...this.queue.queue_running, ...this.queue.queue_pending].map((e) => e[1]))
    for (const [pid, job] of this.active) {
      const a = this.ws().project(job.projectPath).attempt(job.attemptId)
      if (a && a.status === 'queued' && !inQueue.has(pid) && !this.finalizing.has(pid)) void this.settleMissing(pid)
    }
    this.emitQueue()
  }

  private async settleMissing(pid: string): Promise<void> {
    const job = this.active.get(pid)
    const client = this.server.client
    if (!job || !client) return
    let h: HistoryEntry | null
    try {
      h = await client.getHistory(pid)
    } catch {
      return // not an answer: the next queue poll asks again
    }
    if (!this.active.has(pid)) return
    if (h) await this.settleFromHistory(pid, job, h)
    else {
      // Give the server a moment: the job may be between the queue and the history.
      const a = this.ws().project(job.projectPath).attempt(job.attemptId)
      if (a && Date.now() - Date.parse(a.createdAt) > 10_000) {
        this.fail(pid, job, { message: 'Removed from the queue before it started.' }, 'cancelled')
      }
    }
  }

  private async settleFromHistory(pid: string, job: ActiveJob, h: HistoryEntry): Promise<FinishedJob | null> {
    const msgs = h.status?.messages ?? []
    const interrupted = msgs.find(([t]) => t === 'execution_interrupted')
    if (interrupted) {
      this.fail(pid, job, { message: 'Stopped before it finished. No video was saved.' }, 'cancelled')
      return this.finished[0]
    }
    return this.finalize(pid, h)
  }

  private emitQueueSoon(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emitQueue()
    }, 200)
  }

  private emitQueue(): void {
    this.emit({ type: 'queue', snapshot: this.snapshot() })
  }

  snapshot(): QueueSnapshot {
    const toJob = (e: QueueEntry): QueueJob => {
      const pid = e[1]
      const job = this.active.get(pid)
      const live = this.live.get(pid)
      if (!job) {
        return { promptId: pid, number: e[0], ours: false }
      }
      const runLabel = `${job.promptCount} prompt${job.promptCount === 1 ? '' : 's'} × ${job.runCount} run${job.runCount === 1 ? '' : 's'}`
      const note =
        job.promptCount > 1
          ? `prompt ${job.promptIndex + 1} of ${job.promptCount}${job.runCount > 1 ? `, run ${job.runIndex + 1} of ${job.runCount}` : ''} · ${job.seedNote}`
          : job.runCount > 1
            ? `run ${job.runIndex + 1} of ${job.runCount} · ${job.seedNote}`
            : `Single job · ${job.seedNote}`
      return {
        promptId: pid,
        number: e[0],
        ours: true,
        projectPath: job.projectPath,
        projectName: this.ws().projectName(job.projectPath),
        shotId: job.shotId,
        shotName: job.shotName,
        attemptId: job.attemptId,
        attemptNum: job.attemptNum,
        workflowName: job.workflowName,
        runId: job.runId,
        runLabel,
        note,
        progress: live?.percent ?? 0,
        stage: live?.stage ?? 'Starting',
        startedAt: live?.startedAt ?? null
      }
    }
    const running = this.queue.queue_running[0] ? toJob(this.queue.queue_running[0]) : null
    const waiting = [...this.queue.queue_pending].sort((a, b) => a[0] - b[0]).map(toJob)
    return { running, waiting, finished: this.finished, ourWaitingCount: waiting.filter((w) => w.ours).length }
  }

  /** Progress of an active attempt (for the attempt cards). */
  progressOf(projectPath: string, attemptId: number): number | null {
    for (const [pid, j] of this.active) {
      if (j.attemptId === attemptId && j.projectPath === resolve(projectPath)) return this.live.get(pid)?.percent ?? 0
    }
    return null
  }

  /* --------------------------------------------------------------- cancel */

  /** Removes waiting jobs by id (only these ids, never a clear-all). */
  async cancelJobs(promptIds: string[]): Promise<void> {
    const client = this.server.client
    if (!client) throw new Error("Can't reach the server.")
    const q = await client.getQueue()
    const waiting = new Set(q.queue_pending.map((e) => e[1]))
    const ids = promptIds.filter((id) => waiting.has(id))
    await client.deleteQueued(ids)
    const after = await client.getQueue()
    const still = new Set(after.queue_pending.map((e) => e[1]))
    const notRemoved = ids.filter((id) => still.has(id))
    for (const id of ids) {
      const job = this.active.get(id)
      if (job && !still.has(id)) this.fail(id, job, { message: 'Removed from the queue before it started.', stoppedAt: 0 }, 'cancelled')
    }
    this.queue = after
    this.emitQueue()
    if (notRemoved.length) throw new Error('The server did not remove the job. This ComfyUI version may not support cancelling a waiting job.')
  }

  async cancelOtherClientJob(promptId: string): Promise<void> {
    const client = this.server.client
    if (!client) throw new Error("Can't reach the server.")
    await client.deleteQueued([promptId])
    await this.refreshQueue()
  }

  /** Interrupts the running job, only if it belongs to this app. */
  async interrupt(promptId: string): Promise<void> {
    const client = this.server.client
    if (!client) throw new Error("Can't reach the server.")
    const q = await client.getQueue()
    const running = q.queue_running[0]?.[1]
    if (running !== promptId) throw new Error('That job is no longer running.')
    if (!this.active.has(promptId)) throw new Error('The running job was started from another client. It cannot be interrupted from here.')
    await client.interrupt(promptId)
  }

  async cancelAllWaiting(): Promise<number> {
    const client = this.server.client
    if (!client) throw new Error("Can't reach the server.")
    const q = await client.getQueue()
    const ours = q.queue_pending.map((e) => e[1]).filter((id) => this.active.has(id))
    if (ours.length) await this.cancelJobs(ours)
    return ours.length
  }

  async cancelAttempt(projectPath: string, attemptId: number): Promise<void> {
    const pdb = this.ws().project(projectPath)
    const a = pdb.attempt(attemptId)
    if (!a?.promptId) return
    // Sent to a server this app is no longer connected to: it cannot be reached, so only stop tracking it.
    const sentTo = pdb.serverOf(a.id)
    if (sentTo && sentTo !== this.server.url_ && (a.status === 'queued' || a.status === 'running')) {
      const job = this.active.get(a.promptId) ?? this.jobInfo(projectPath, pdb, a, null)
      this.fail(a.promptId, job, { message: `Sent to ${sentTo}, which is no longer the server in Settings. The app stopped tracking it; it was not cancelled there.` }, 'cancelled')
      return
    }
    if (a.status === 'running') await this.interrupt(a.promptId)
    else if (a.status === 'queued') {
      const client = this.server.client
      const q = client ? await client.getQueue() : null
      if (q?.queue_running[0]?.[1] === a.promptId) await this.interrupt(a.promptId)
      else await this.cancelJobs([a.promptId])
    }
  }

  /* ------------------------------------------------------------ reconcile */

  /** Runs reconcile again shortly. If the server is gone by then, the next connect does it. */
  private reconcileSoon(): void {
    if (this.reconcileTimer) return
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null
      if (this.server.connected) void this.reconcile()
    }, 5000)
  }

  /** On launch and reconnect: compare our active attempts with the server's queue and history. */
  async reconcile(): Promise<void> {
    const client = this.server.client
    if (!client) return
    let q: QueueState
    try {
      q = await client.getQueue()
    } catch {
      return
    }
    this.queue = q
    const running = new Set(q.queue_running.map((e) => e[1]))
    const pending = new Set(q.queue_pending.map((e) => e[1]))
    const summary: ReconcileSummary = { finished: [], failed: [], stillWaiting: 0 }
    const server = this.server.url_
    let unanswered = false
    for (const [pid, job] of [...this.active]) {
      const pdb = this.ws().project(job.projectPath)
      const a = pdb.attempt(job.attemptId)
      if (!a) {
        this.active.delete(pid)
        continue
      }
      const sentTo = pdb.serverOf(a.id)
      if (sentTo && sentTo !== server) continue
      if (pending.has(pid)) {
        summary.stillWaiting++
        if (a.status !== 'queued') this.update(job, { status: 'queued' })
        continue
      }
      if (running.has(pid)) {
        if (a.status !== 'running') this.update(job, { status: 'running' })
        continue
      }
      if (this.finalizing.has(pid)) continue
      let h: HistoryEntry | null
      try {
        h = await client.getHistory(pid)
      } catch {
        // A failed request says nothing about the job: leave it as it is and ask again.
        unanswered = true
        continue
      }
      let f: FinishedJob | null
      if (h) f = await this.settleFromHistory(pid, job, h)
      else {
        this.fail(pid, job, { message: 'The server has no record of this job. It may have restarted before running it.' }, 'failed')
        f = this.finished[0]
      }
      if (f) (f.status === 'failed' || f.status === 'cancelled' ? summary.failed : summary.finished).push(f)
    }
    this.emitQueue()
    if (unanswered) this.reconcileSoon()
    if (summary.finished.length || summary.failed.length) {
      this.lastSummary = summary
      this.emit({ type: 'reconciled', summary })
    }
  }
}

function rank(filename: string): number {
  const k = mediaKind(filename)
  return k === 'video' ? 0 : k === 'image' ? 1 : k === 'audio' ? 2 : 3
}

function formatSecs(s: number): string {
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

function keyForFile(inputs: SchemaInput[], values: Record<string, unknown>, file: string): string {
  for (const i of inputs) {
    const v = values[i.key]
    if (v === file || (Array.isArray(v) && v.includes(file))) return i.key
  }
  return ''
}

/** Maps a /prompt rejection onto input keys where possible. */
export function mapRejection(schema: WorkflowSchema, body: PromptRejection): { fieldErrors: Record<string, string>; general: string[] } {
  const fieldErrors: Record<string, string> = {}
  const general: string[] = []
  for (const [nodeId, ne] of Object.entries(body.node_errors ?? {})) {
    for (const err of ne.errors ?? []) {
      const inputName = err.extra_info?.input_name
      const text = [err.message, err.details].filter(Boolean).join(': ')
      const input = schema.inputs.find((i) => {
        const t = i.target
        if (t.kind === 'field') return t.nodeId === nodeId && (!inputName || inputName === t.field)
        if (t.kind === 'file') return t.nodeId === nodeId || t.via === nodeId || (t.consumerId === nodeId && inputName === t.consumerInput)
        return t.consumerId === nodeId || t.slots.some((s) => s.nodeId === nodeId || s.via === nodeId)
      })
      if (input) fieldErrors[input.key] = text
      else general.push(`${ne.class_type}: ${text}.`)
    }
  }
  if (!Object.keys(fieldErrors).length && !general.length && body.error?.message) {
    general.push([body.error.message, body.error.details].filter(Boolean).join(': '))
  }
  return { fieldErrors, general }
}
