import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { AppDb, ProjectDb, type WorkflowRow } from './db'
import { buildSchema } from '@core/workflow/schema'
import { detectFormat } from '@core/workflow/format'
import type { ApiWorkflow, Overrides } from '@core/workflow/types'
import type { ObjectInfo } from '@core/workflow/objectInfo'
import { safeName } from '@core/output/naming'
import type { ImportCommit, ProjectInfo, ResetScope, WorkflowInfo } from '@shared/types'

const GITIGNORE = `# Comfy Director workspace: only workflows/ is meant for git.
app.db
app.db-*
projects/
`

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

export function workflowIdFromName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'workflow'
  )
}

export interface LoadedWorkflow {
  row: WorkflowRow
  workflow: ApiWorkflow
  overrides: Overrides
  text: string
}

/** One workspace folder: app-wide `workflows/` and `app.db`, plus a folder per project. */
export class Workspace {
  readonly app: AppDb
  private projectDbs = new Map<string, ProjectDb>()

  constructor(readonly root: string) {
    mkdirSync(join(root, 'workflows'), { recursive: true })
    mkdirSync(join(root, 'projects'), { recursive: true })
    const gi = join(root, '.gitignore')
    if (!existsSync(gi)) writeFileSync(gi, GITIGNORE)
    this.app = new AppDb(join(root, 'app.db'))
  }

  close(): void {
    for (const db of this.projectDbs.values()) db.close()
    this.projectDbs.clear()
    this.app.close()
  }

  /* ------------------------------------------------------------ workflows */

  workflowDir(id: string): string {
    return join(this.root, 'workflows', id)
  }

  loadWorkflow(id: string): LoadedWorkflow | null {
    const row = this.app.workflow(id)
    if (!row) return null
    const dir = this.workflowDir(id)
    let text: string
    try {
      text = readFileSync(join(dir, 'workflow.json'), 'utf8')
    } catch {
      return null
    }
    let fmt: ReturnType<typeof detectFormat>
    try {
      fmt = detectFormat(JSON.parse(text))
    } catch {
      return null // not valid JSON (hand-edited): skip it, like an unreadable file
    }
    if (fmt.format !== 'api') return null
    let overrides: Overrides = {}
    try {
      overrides = JSON.parse(readFileSync(join(dir, 'overrides.json'), 'utf8'))
    } catch {
      /* none */
    }
    // workflow.json edited by hand (or re-exported over the file): record it as a new version.
    const hash = sha256(text)
    if (hash !== row.hash) {
      const next = { ...row, version: row.version + 1, hash, imported_at: new Date().toISOString() }
      this.app.upsertWorkflow(next)
      return { row: next, workflow: fmt.workflow, overrides, text }
    }
    return { row, workflow: fmt.workflow, overrides, text }
  }

  /** Workflow files found on disk but not in the index (e.g. after cloning workflows/ from git). */
  private indexLooseFolders(): void {
    const dir = join(this.root, 'workflows')
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const id of names) {
      if (this.app.workflow(id)) continue
      const file = join(dir, id, 'workflow.json')
      if (!existsSync(file)) continue
      const text = readFileSync(file, 'utf8')
      try {
        if (detectFormat(JSON.parse(text)).format !== 'api') continue
      } catch {
        continue
      }
      this.app.upsertWorkflow({ id, name: id, version: this.app.nextWorkflowVersion(id), hash: sha256(text), imported_at: new Date().toISOString() })
    }
  }

  listWorkflows(oi: ObjectInfo | null): WorkflowInfo[] {
    this.indexLooseFolders()
    const out: WorkflowInfo[] = []
    for (const r of this.app.workflows()) {
      const w = this.loadWorkflow(r.id)
      if (!w) continue
      out.push(this.info(w, oi))
    }
    return out
  }

  info(w: LoadedWorkflow, oi: ObjectInfo | null): WorkflowInfo {
    const s = buildSchema(w.workflow, w.overrides, oi)
    return {
      id: w.row.id,
      name: w.row.name,
      version: w.row.version,
      hash: w.row.hash,
      importedAt: w.row.imported_at,
      nodeCount: Object.keys(w.workflow).length,
      nodeTypeCount: new Set(Object.values(w.workflow).map((n) => n.class_type)).size,
      inputs: s.inputs,
      seedCount: s.seedTargets.length,
      duplicateKeys: s.duplicateKeys,
      warnings: s.warnings,
      overrides: w.overrides
    }
  }

  importWorkflow(c: ImportCommit): string {
    const fmt = detectFormat(JSON.parse(c.text))
    if (fmt.format !== 'api') throw new Error(fmt.message)
    const name = c.name.trim() || 'workflow'
    let id: string
    let version: number
    if (c.mode === 'replace' && c.replaceId && this.app.workflow(c.replaceId)) {
      id = c.replaceId
      const prev = this.app.workflow(id)!
      version = prev.version + 1
      // Keep the previous version's files so attempts can still reference it.
      const dir = this.workflowDir(id)
      const vdir = join(dir, 'versions', String(prev.version))
      mkdirSync(vdir, { recursive: true })
      for (const f of ['workflow.json', 'overrides.json']) {
        if (existsSync(join(dir, f))) cpSync(join(dir, f), join(vdir, f))
      }
    } else {
      const base = workflowIdFromName(name)
      id = base
      for (let n = 2; this.app.workflow(id) || existsSync(this.workflowDir(id)); n++) id = `${base}_${n}`
      version = this.app.nextWorkflowVersion(id)
    }
    const dir = this.workflowDir(id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workflow.json'), c.text)
    this.writeOverrides(id, c.overrides)
    this.app.upsertWorkflow({ id, name, version, hash: sha256(c.text), imported_at: new Date().toISOString() })
    this.app.setMeta('last_workflow', id)
    return id
  }

  private writeOverrides(id: string, overrides: Overrides): void {
    const file = join(this.workflowDir(id), 'overrides.json')
    const hasOverrides = (overrides.expose?.length ?? 0) > 0 || Object.keys(overrides.inputs ?? {}).length > 0
    if (hasOverrides) writeFileSync(file, JSON.stringify(overrides, null, 2) + '\n')
    else if (existsSync(file)) writeFileSync(file, '{}\n')
  }

  /** Renames a workflow and changes its exposed inputs. The graph is untouched, so the version stays. */
  updateWorkflow(id: string, name: string, overrides: Overrides): void {
    const row = this.app.workflow(id)
    if (!row) throw new Error('This workflow no longer exists.')
    this.writeOverrides(id, overrides)
    this.app.upsertWorkflow({ ...row, name: name.trim() || row.name })
  }

  /** Forgets a workflow. The caller removes its folder first, or it would be indexed again. */
  removeWorkflow(id: string): void {
    this.app.deleteWorkflow(id)
    if (this.app.getMeta('last_workflow') === id) this.app.setMeta('last_workflow', null)
  }

  /* ------------------------------------------------------------- projects */

  projectsDir(): string {
    return join(this.root, 'projects')
  }

  project(path: string): ProjectDb {
    const key = resolve(path)
    let db = this.projectDbs.get(key)
    if (!db) {
      if (!existsSync(key)) throw new Error(`The project folder is missing: ${key}`)
      mkdirSync(join(key, 'inputs'), { recursive: true })
      mkdirSync(join(key, 'outputs'), { recursive: true })
      db = new ProjectDb(join(key, 'project.db'))
      this.projectDbs.set(key, db)
    }
    return db
  }

  closeProject(path: string): void {
    const key = resolve(path)
    this.projectDbs.get(key)?.close()
    this.projectDbs.delete(key)
  }

  listProjects(): ProjectInfo[] {
    return this.app.projects().map((p) => {
      const missing = !existsSync(join(p.path, 'project.db'))
      let shotCount = 0
      if (!missing) {
        try {
          shotCount = this.project(p.path).shotCount()
        } catch {
          /* unreadable */
        }
      }
      return { path: p.path, name: p.name, shotCount, missing }
    })
  }

  validateProjectName(name: string, except?: string): string | null {
    const n = name.trim()
    if (!n) return 'Enter a name.'
    if (safeName(n) !== n) return 'Use a name without / \\ : * ? " < > | and without a trailing dot.'
    const target = resolve(this.projectsDir(), n)
    const taken = this.app.projects().some((p) => p.name.toLowerCase() === n.toLowerCase() && resolve(p.path) !== except)
    if (taken || (existsSync(target) && target !== except)) return 'A project with this name already exists.'
    return null
  }

  createProject(name: string): ProjectInfo {
    const err = this.validateProjectName(name)
    if (err) throw new Error(err)
    const path = resolve(this.projectsDir(), name.trim())
    mkdirSync(path, { recursive: true })
    this.project(path)
    this.app.addProject(path, name.trim())
    return { path, name: name.trim(), shotCount: 0, missing: false }
  }

  addExistingProject(path: string): ProjectInfo {
    const p = resolve(path)
    if (!existsSync(join(p, 'project.db'))) throw new Error('This folder has no project.db. Pick a Comfy Director project folder.')
    const name = basename(p)
    this.app.addProject(p, name)
    return { path: p, name, shotCount: this.project(p).shotCount(), missing: false }
  }

  /** Renames the project folder; everything inside uses relative paths. */
  renameProject(path: string, name: string): ProjectInfo {
    const old = resolve(path)
    const err = this.validateProjectName(name, old)
    if (err) throw new Error(err)
    const target = join(dirname(old), name.trim())
    this.closeProject(old)
    if (target !== old) renameSync(old, target)
    this.app.renameProject(old, target, name.trim())
    return { path: target, name: name.trim(), shotCount: this.project(target).shotCount(), missing: false }
  }

  removeProject(path: string): void {
    this.closeProject(path)
    this.app.removeProject(resolve(path))
  }

  projectName(path: string): string {
    return this.app.projects().find((p) => resolve(p.path) === resolve(path))?.name ?? basename(path)
  }

  /** Every registered project folder that still exists. */
  projectPaths(): string[] {
    return this.app.projects().map((p) => resolve(p.path)).filter((p) => existsSync(join(p, 'project.db')))
  }

  /* ---------------------------------------------------------------- reset */

  /** Registered projects whose folder is not inside `projects/` (added with Open existing project). */
  externalProjects(): { path: string; name: string }[] {
    return this.app.projects().filter((p) => {
      const rel = relative(this.projectsDir(), resolve(p.path))
      return !rel || rel.startsWith('..') || isAbsolute(rel)
    })
  }

  /** The first project that still has queued or running attempts, if any. */
  projectWithActiveJobs(): string | null {
    for (const p of this.projectPaths()) {
      try {
        if (this.project(p).activeAttempts().length) return this.projectName(p)
      } catch {
        /* unreadable */
      }
    }
    return null
  }

  /**
   * Empties `projects/` (and `workflows/` for 'all') and clears their records in app.db.
   * `remove` takes a folder off the disk. Projects outside the workspace are only forgotten.
   * Records are cleared after their folder is gone, so a failed removal leaves that part as it was.
   */
  async reset(scope: ResetScope, remove: (dir: string) => Promise<void>): Promise<void> {
    const empty = async (dir: string): Promise<void> => {
      if (existsSync(dir) && readdirSync(dir).length) await remove(dir)
      mkdirSync(dir, { recursive: true })
    }
    // Open databases hold file handles, which block removing their folder on Windows.
    for (const db of this.projectDbs.values()) db.close()
    this.projectDbs.clear()
    await empty(this.projectsDir())
    this.app.clearProjects()
    if (scope === 'all') {
      await empty(join(this.root, 'workflows'))
      this.app.clearWorkflows()
    }
  }
}
