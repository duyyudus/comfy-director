import Database from 'better-sqlite3'
import type {
  Attempt, AttemptError, AttemptStatus, ChatMessage, InputFile, LibraryPrompt, OutputFile, PrompterRecord, Sequence, Shot, ShotSummary
} from '@shared/types'
import type { PrompterConfig, PrompterType } from '@core/prompter/types'

export const now = (): string => new Date().toISOString()
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function open(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

/* ------------------------------------------------------------------ app.db */

export interface WorkflowRow {
  id: string
  name: string
  version: number
  hash: string
  imported_at: string
}

export class AppDb {
  readonly db: Database.Database
  constructor(path: string) {
    this.db = open(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS workflows(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
        imported_at TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS workflow_versions(
        workflow_id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, imported_at TEXT NOT NULL,
        PRIMARY KEY(workflow_id, version));
      CREATE TABLE IF NOT EXISTS projects(path TEXT PRIMARY KEY, name TEXT NOT NULL, added_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prompts(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '', used_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, last_used_in TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prompters(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `)
  }

  getMeta(key: string): string | null {
    return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value ?? null
  }
  setMeta(key: string, value: string | null): void {
    this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }

  // workflows
  workflows(): WorkflowRow[] {
    return this.db.prepare('SELECT id,name,version,hash,imported_at FROM workflows ORDER BY position, imported_at').all() as WorkflowRow[]
  }
  workflow(id: string): WorkflowRow | null {
    return (this.db.prepare('SELECT id,name,version,hash,imported_at FROM workflows WHERE id=?').get(id) as WorkflowRow) ?? null
  }
  upsertWorkflow(row: WorkflowRow): void {
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM workflows').get() as { p: number }).p
    this.db
      .prepare(`INSERT INTO workflows(id,name,version,hash,imported_at,position) VALUES(@id,@name,@version,@hash,@imported_at,${pos})
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, hash=excluded.hash, imported_at=excluded.imported_at`)
      .run(row)
    this.db
      .prepare('INSERT OR REPLACE INTO workflow_versions(workflow_id,version,hash,imported_at) VALUES(?,?,?,?)')
      .run(row.id, row.version, row.hash, row.imported_at)
  }
  /** Version history is kept, so an id that is imported again continues its numbering. */
  deleteWorkflow(id: string): void {
    this.db.prepare('DELETE FROM workflows WHERE id=?').run(id)
  }
  /** Unlike deleteWorkflow, this drops the version history too: numbering starts again at 1. */
  clearWorkflows(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM workflows').run()
      this.db.prepare('DELETE FROM workflow_versions').run()
      this.db.prepare("DELETE FROM meta WHERE key='last_workflow'").run()
    })()
  }
  nextWorkflowVersion(id: string): number {
    return (this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS v FROM workflow_versions WHERE workflow_id=?').get(id) as { v: number }).v
  }

  // projects
  projects(): { path: string; name: string }[] {
    return this.db.prepare('SELECT path,name FROM projects ORDER BY name COLLATE NOCASE').all() as { path: string; name: string }[]
  }
  addProject(path: string, name: string): void {
    this.db.prepare('INSERT INTO projects(path,name,added_at) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name').run(path, name, now())
  }
  removeProject(path: string): void {
    this.db.prepare('DELETE FROM projects WHERE path=?').run(path)
  }
  clearProjects(): void {
    this.db.prepare('DELETE FROM projects').run()
  }
  renameProject(oldPath: string, newPath: string, name: string): void {
    this.db.prepare('UPDATE projects SET path=?, name=? WHERE path=?').run(newPath, name, oldPath)
  }

  // prompts
  prompts(): LibraryPrompt[] {
    return (this.db.prepare('SELECT * FROM prompts ORDER BY COALESCE(last_used_at, updated_at) DESC').all() as PromptRow[]).map(promptFromRow)
  }
  prompt(id: number): LibraryPrompt | null {
    const r = this.db.prepare('SELECT * FROM prompts WHERE id=?').get(id) as PromptRow | undefined
    return r ? promptFromRow(r) : null
  }
  savePrompt(p: Partial<LibraryPrompt> & { name: string; text: string }): LibraryPrompt {
    const t = now()
    if (p.id) {
      this.db
        .prepare('UPDATE prompts SET name=?, text=?, tags=?, note=?, updated_at=? WHERE id=?')
        .run(p.name, p.text, JSON.stringify(p.tags ?? []), p.note ?? '', t, p.id)
      return this.prompt(p.id)!
    }
    const r = this.db
      .prepare('INSERT INTO prompts(name,text,tags,note,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(p.name, p.text, JSON.stringify(p.tags ?? []), p.note ?? '', t, t)
    return this.prompt(Number(r.lastInsertRowid))!
  }
  deletePrompt(id: number): void {
    this.db.prepare('DELETE FROM prompts WHERE id=?').run(id)
  }
  markPromptUsed(id: number, where: string): void {
    this.db.prepare('UPDATE prompts SET used_count=used_count+1, last_used_at=?, last_used_in=? WHERE id=?').run(now(), where, id)
  }

  // prompters
  prompters(): PrompterRecord[] {
    return (this.db.prepare('SELECT * FROM prompters ORDER BY name COLLATE NOCASE').all() as PrompterRow[]).map(prompterFromRow)
  }
  prompter(id: number): PrompterRecord | null {
    const r = this.db.prepare('SELECT * FROM prompters WHERE id=?').get(id) as PrompterRow | undefined
    return r ? prompterFromRow(r) : null
  }
  savePrompter(p: { id?: number; name: string; config: PrompterConfig }): PrompterRecord {
    const t = now()
    if (p.id) {
      this.db.prepare('UPDATE prompters SET name=?, type=?, config=?, updated_at=? WHERE id=?').run(p.name, p.config.type, JSON.stringify(p.config), t, p.id)
      return prompterFromRow(this.db.prepare('SELECT * FROM prompters WHERE id=?').get(p.id) as PrompterRow)
    }
    const r = this.db
      .prepare('INSERT INTO prompters(name,type,config,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(p.name, p.config.type, JSON.stringify(p.config), t, t)
    return prompterFromRow(this.db.prepare('SELECT * FROM prompters WHERE id=?').get(r.lastInsertRowid) as PrompterRow)
  }
  deletePrompter(id: number): void {
    this.db.prepare('DELETE FROM prompters WHERE id=?').run(id)
  }

  close(): void {
    this.db.close()
  }
}

interface PromptRow {
  id: number; name: string; text: string; tags: string; note: string; used_count: number
  last_used_at: string | null; last_used_in: string | null; created_at: string; updated_at: string
}
const promptFromRow = (r: PromptRow): LibraryPrompt => ({
  id: r.id, name: r.name, text: r.text, tags: parse(r.tags, []), note: r.note, usedCount: r.used_count,
  lastUsedAt: r.last_used_at, lastUsedIn: r.last_used_in, createdAt: r.created_at, updatedAt: r.updated_at
})
interface PrompterRow { id: number; name: string; type: string; config: string; created_at: string; updated_at: string }
const prompterFromRow = (r: PrompterRow): PrompterRecord => ({
  id: r.id, name: r.name, type: r.type as PrompterType, config: parse(r.config, { type: 'template' } as PrompterConfig),
  createdAt: r.created_at, updatedAt: r.updated_at
})

/* -------------------------------------------------------------- project.db */

interface ShotRow {
  id: number; name: string; sequence_id: number | null; position: number | null; workflow_id: string | null
  values_json: string; prompt_mode: string; prompt_list: string; seed_mode: string; seed_value: number | null
  last_seed: number | null; runs: number; keeper_attempt_id: number | null; next_attempt_num: number
  created_at: string; updated_at: string
}

interface AttemptRow {
  id: number; shot_id: number; num: number; workflow_id: string; workflow_name: string; workflow_version: number
  workflow_hash: string; values_json: string; seed: number; status: string; prompt_id: string | null
  server_url: string | null; run_id: string; prompt_index: number; prompt_count: number; run_index: number
  run_count: number; final_json: string | null; outputs_json: string; thumb: string | null
  media_duration: number | null; error_json: string | null; progress: number; created_at: string
  started_at: string | null; finished_at: string | null
}

const shotFromRow = (r: ShotRow): Shot => ({
  id: r.id, name: r.name, sequenceId: r.sequence_id, position: r.position, workflowId: r.workflow_id,
  values: parse(r.values_json, {}), promptMode: r.prompt_mode === 'list' ? 'list' : 'single',
  promptList: parse(r.prompt_list, []), seedMode: r.seed_mode === 'fixed' ? 'fixed' : 'random',
  seedValue: r.seed_value, lastSeed: r.last_seed, runs: r.runs, keeperAttemptId: r.keeper_attempt_id,
  createdAt: r.created_at, updatedAt: r.updated_at
})

const attemptFromRow = (r: AttemptRow): Attempt => ({
  id: r.id, shotId: r.shot_id, num: r.num, workflowId: r.workflow_id, workflowName: r.workflow_name,
  workflowVersion: r.workflow_version, workflowHash: r.workflow_hash, values: parse(r.values_json, {}), seed: r.seed,
  status: r.status as AttemptStatus, promptId: r.prompt_id, runId: r.run_id, promptIndex: r.prompt_index,
  promptCount: r.prompt_count, runIndex: r.run_index, runCount: r.run_count, outputs: parse<OutputFile[]>(r.outputs_json, []),
  thumb: r.thumb, mediaDuration: r.media_duration, error: parse<AttemptError | null>(r.error_json, null),
  progress: r.progress, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at
})

export interface NewAttempt {
  shotId: number
  workflowId: string
  workflowName: string
  workflowVersion: number
  workflowHash: string
  values: Record<string, unknown>
  seed: number
  runId: string
  promptIndex: number
  promptCount: number
  runIndex: number
  runCount: number
  finalJson: string
  serverUrl: string
}

export const ACTIVE_STATUSES: AttemptStatus[] = ['submitting', 'queued', 'running']

export class ProjectDb {
  readonly db: Database.Database
  constructor(readonly path: string) {
    this.db = open(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS sequences(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shots(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        sequence_id INTEGER REFERENCES sequences(id) ON DELETE SET NULL, position INTEGER,
        workflow_id TEXT, values_json TEXT NOT NULL DEFAULT '{}', prompt_mode TEXT NOT NULL DEFAULT 'single',
        prompt_list TEXT NOT NULL DEFAULT '[]', seed_mode TEXT NOT NULL DEFAULT 'random', seed_value INTEGER,
        last_seed INTEGER, runs INTEGER NOT NULL DEFAULT 1, keeper_attempt_id INTEGER,
        next_attempt_num INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(
        id INTEGER PRIMARY KEY, shot_id INTEGER NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
        num INTEGER NOT NULL, workflow_id TEXT NOT NULL, workflow_name TEXT NOT NULL,
        workflow_version INTEGER NOT NULL, workflow_hash TEXT NOT NULL, values_json TEXT NOT NULL,
        seed INTEGER NOT NULL, status TEXT NOT NULL, prompt_id TEXT, server_url TEXT, run_id TEXT NOT NULL,
        prompt_index INTEGER NOT NULL DEFAULT 0, prompt_count INTEGER NOT NULL DEFAULT 1,
        run_index INTEGER NOT NULL DEFAULT 0, run_count INTEGER NOT NULL DEFAULT 1,
        final_json TEXT, outputs_json TEXT NOT NULL DEFAULT '[]', thumb TEXT, media_duration REAL,
        error_json TEXT, progress REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        started_at TEXT, finished_at TEXT);
      CREATE INDEX IF NOT EXISTS attempts_shot ON attempts(shot_id, id DESC);
      CREATE INDEX IF NOT EXISTS attempts_prompt ON attempts(prompt_id);
      CREATE INDEX IF NOT EXISTS attempts_status ON attempts(status);
      CREATE TABLE IF NOT EXISTS inputs(name TEXT PRIMARY KEY, original_name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads(
        name TEXT NOT NULL, server TEXT NOT NULL, server_name TEXT NOT NULL, PRIMARY KEY(name, server));
      CREATE TABLE IF NOT EXISTS chat_messages(
        id INTEGER PRIMARY KEY, shot_id INTEGER NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
        role TEXT NOT NULL, text TEXT NOT NULL, images_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_shot ON chat_messages(shot_id, id);
    `)
  }

  close(): void {
    this.db.close()
  }

  // sequences
  sequences(): Sequence[] {
    return this.db.prepare('SELECT id,name,position FROM sequences ORDER BY position, id').all() as Sequence[]
  }
  sequence(id: number): Sequence | null {
    return (this.db.prepare('SELECT id,name,position FROM sequences WHERE id=?').get(id) as Sequence) ?? null
  }
  createSequence(name: string): Sequence {
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM sequences').get() as { p: number }).p
    const r = this.db.prepare('INSERT INTO sequences(name,position,created_at) VALUES(?,?,?)').run(name, pos, now())
    return this.sequence(Number(r.lastInsertRowid))!
  }
  renameSequence(id: number, name: string): void {
    this.db.prepare('UPDATE sequences SET name=? WHERE id=?').run(name, id)
  }
  deleteSequence(id: number, deleteShots = false): void {
    this.db.transaction(() => {
      if (deleteShots) this.db.prepare('DELETE FROM shots WHERE sequence_id=?').run(id)
      else this.db.prepare('UPDATE shots SET sequence_id=NULL, position=NULL WHERE sequence_id=?').run(id)
      this.db.prepare('DELETE FROM sequences WHERE id=?').run(id)
    })()
  }

  // shots
  shotSummaries(): ShotSummary[] {
    const rows = this.db
      .prepare(`SELECT s.id, s.name, s.sequence_id, s.position, s.workflow_id, s.keeper_attempt_id,
        (SELECT COUNT(*) FROM attempts a WHERE a.shot_id=s.id AND a.status!='submitting') AS n
        FROM shots s ORDER BY s.sequence_id, s.position, s.created_at`)
      .all() as { id: number; name: string; sequence_id: number | null; position: number | null; workflow_id: string | null; keeper_attempt_id: number | null; n: number }[]
    return rows.map((r) => ({
      id: r.id, name: r.name, sequenceId: r.sequence_id, position: r.position, hasKeeper: r.keeper_attempt_id !== null,
      attemptCount: r.n, workflowId: r.workflow_id
    }))
  }
  shotCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM shots').get() as { n: number }).n
  }
  shot(id: number): Shot | null {
    const r = this.db.prepare('SELECT * FROM shots WHERE id=?').get(id) as ShotRow | undefined
    return r ? shotFromRow(r) : null
  }
  shotsInSequence(sequenceId: number): Shot[] {
    return (this.db.prepare('SELECT * FROM shots WHERE sequence_id=? ORDER BY position').all(sequenceId) as ShotRow[]).map(shotFromRow)
  }
  createShot(s: { name: string; sequenceId: number | null; position?: number | null; workflowId: string | null; values?: Record<string, unknown>; template?: Shot }): Shot {
    const t = now()
    let position: number | null = null
    if (s.sequenceId !== null) {
      position = s.position ?? (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM shots WHERE sequence_id=?').get(s.sequenceId) as { p: number }).p
      this.db.prepare('UPDATE shots SET position=position+1 WHERE sequence_id=? AND position>=?').run(s.sequenceId, position)
    }
    const tpl = s.template
    const r = this.db
      .prepare(`INSERT INTO shots(name,sequence_id,position,workflow_id,values_json,prompt_mode,prompt_list,seed_mode,seed_value,runs,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        s.name, s.sequenceId, position, s.workflowId, JSON.stringify(s.values ?? tpl?.values ?? {}),
        tpl?.promptMode ?? 'single', JSON.stringify(tpl?.promptList ?? []), tpl?.seedMode ?? 'random',
        tpl?.seedValue ?? null, tpl?.runs ?? 1, t, t
      )
    return this.shot(Number(r.lastInsertRowid))!
  }
  updateShot(id: number, patch: Partial<Shot>): Shot {
    const cols: string[] = []
    const vals: unknown[] = []
    const set = (c: string, v: unknown): void => {
      cols.push(`${c}=?`)
      vals.push(v)
    }
    if (patch.name !== undefined) set('name', patch.name)
    if (patch.workflowId !== undefined) set('workflow_id', patch.workflowId)
    if (patch.values !== undefined) set('values_json', JSON.stringify(patch.values))
    if (patch.promptMode !== undefined) set('prompt_mode', patch.promptMode)
    if (patch.promptList !== undefined) set('prompt_list', JSON.stringify(patch.promptList))
    if (patch.seedMode !== undefined) set('seed_mode', patch.seedMode)
    if (patch.seedValue !== undefined) set('seed_value', patch.seedValue)
    if (patch.lastSeed !== undefined) set('last_seed', patch.lastSeed)
    if (patch.runs !== undefined) set('runs', Math.max(1, Math.floor(patch.runs)))
    if (patch.keeperAttemptId !== undefined) set('keeper_attempt_id', patch.keeperAttemptId)
    if (cols.length) {
      set('updated_at', now())
      this.db.prepare(`UPDATE shots SET ${cols.join(', ')} WHERE id=?`).run(...vals, id)
    }
    return this.shot(id)!
  }
  /** Moves a shot into a sequence at a 1-based position (end if null), or to loose shots. Keeps positions contiguous. */
  moveShot(id: number, sequenceId: number | null, position: number | null): void {
    this.db.transaction(() => {
      const s = this.shot(id)
      if (!s) return
      if (s.sequenceId !== null) {
        this.db.prepare('UPDATE shots SET sequence_id=NULL, position=NULL WHERE id=?').run(id)
        this.compact(s.sequenceId)
      }
      if (sequenceId !== null) {
        const n = (this.db.prepare('SELECT COUNT(*) AS n FROM shots WHERE sequence_id=?').get(sequenceId) as { n: number }).n
        const pos = Math.min(Math.max(1, position ?? n + 1), n + 1)
        this.db.prepare('UPDATE shots SET position=position+1 WHERE sequence_id=? AND position>=?').run(sequenceId, pos)
        this.db.prepare('UPDATE shots SET sequence_id=?, position=?, updated_at=? WHERE id=?').run(sequenceId, pos, now(), id)
      }
    })()
  }
  reorder(sequenceId: number, shotIds: number[]): void {
    this.db.transaction(() => {
      shotIds.forEach((id, i) => this.db.prepare('UPDATE shots SET position=? WHERE id=? AND sequence_id=?').run(i + 1, id, sequenceId))
      this.compact(sequenceId)
    })()
  }
  private compact(sequenceId: number): void {
    const ids = this.db.prepare('SELECT id FROM shots WHERE sequence_id=? ORDER BY position, id').all(sequenceId) as { id: number }[]
    ids.forEach((r, i) => this.db.prepare('UPDATE shots SET position=? WHERE id=?').run(i + 1, r.id))
  }
  deleteShot(id: number): void {
    const s = this.shot(id)
    this.db.prepare('DELETE FROM shots WHERE id=?').run(id)
    if (s?.sequenceId) this.compact(s.sequenceId)
  }

  // attempts
  attemptCount(shotId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE shot_id=? AND status!='submitting'").get(shotId) as { n: number }).n
  }
  attempts(shotId: number, limit = 1000): Attempt[] {
    return (this.db
      .prepare("SELECT * FROM attempts WHERE shot_id=? AND status!='submitting' ORDER BY id DESC LIMIT ?")
      .all(shotId, limit) as AttemptRow[]).map(attemptFromRow)
  }
  attempt(id: number): Attempt | null {
    const r = this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id) as AttemptRow | undefined
    return r ? attemptFromRow(r) : null
  }
  finalJson(id: number): string | null {
    return (this.db.prepare('SELECT final_json FROM attempts WHERE id=?').get(id) as { final_json: string | null } | undefined)?.final_json ?? null
  }
  attemptByPrompt(promptId: string): Attempt | null {
    const r = this.db.prepare('SELECT * FROM attempts WHERE prompt_id=?').get(promptId) as AttemptRow | undefined
    return r ? attemptFromRow(r) : null
  }
  activeAttempts(): Attempt[] {
    return (this.db
      .prepare(`SELECT * FROM attempts WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`)
      .all(...ACTIVE_STATUSES) as AttemptRow[]).map(attemptFromRow)
  }
  createAttempt(a: NewAttempt): Attempt {
    return this.db.transaction(() => {
      const num = (this.db.prepare('SELECT next_attempt_num AS n FROM shots WHERE id=?').get(a.shotId) as { n: number }).n
      this.db.prepare('UPDATE shots SET next_attempt_num=?, last_seed=? WHERE id=?').run(num + 1, a.seed, a.shotId)
      const r = this.db
        .prepare(`INSERT INTO attempts(shot_id,num,workflow_id,workflow_name,workflow_version,workflow_hash,values_json,seed,status,
          server_url,run_id,prompt_index,prompt_count,run_index,run_count,final_json,created_at)
          VALUES(?,?,?,?,?,?,?,?,'submitting',?,?,?,?,?,?,?,?)`)
        .run(a.shotId, num, a.workflowId, a.workflowName, a.workflowVersion, a.workflowHash, JSON.stringify(a.values), a.seed,
          a.serverUrl, a.runId, a.promptIndex, a.promptCount, a.runIndex, a.runCount, a.finalJson, now())
      return this.attempt(Number(r.lastInsertRowid))!
    })()
  }
  updateAttempt(id: number, patch: {
    status?: AttemptStatus; promptId?: string | null; outputs?: OutputFile[]; thumb?: string | null; mediaDuration?: number | null
    error?: AttemptError | null; progress?: number; startedAt?: string | null; finishedAt?: string | null
  }): Attempt | null {
    const cols: string[] = []
    const vals: unknown[] = []
    const set = (c: string, v: unknown): void => {
      cols.push(`${c}=?`)
      vals.push(v)
    }
    if (patch.status !== undefined) set('status', patch.status)
    if (patch.promptId !== undefined) set('prompt_id', patch.promptId)
    if (patch.outputs !== undefined) set('outputs_json', JSON.stringify(patch.outputs))
    if (patch.thumb !== undefined) set('thumb', patch.thumb)
    if (patch.mediaDuration !== undefined) set('media_duration', patch.mediaDuration)
    if (patch.error !== undefined) set('error_json', patch.error ? JSON.stringify(patch.error) : null)
    if (patch.progress !== undefined) set('progress', patch.progress)
    if (patch.startedAt !== undefined) set('started_at', patch.startedAt)
    if (patch.finishedAt !== undefined) set('finished_at', patch.finishedAt)
    if (cols.length) this.db.prepare(`UPDATE attempts SET ${cols.join(', ')} WHERE id=?`).run(...vals, id)
    return this.attempt(id)
  }
  deleteAttempt(id: number): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE shots SET keeper_attempt_id=NULL WHERE keeper_attempt_id=?').run(id)
      this.db.prepare('DELETE FROM attempts WHERE id=?').run(id)
    })()
  }
  attemptsMissingThumb(): Attempt[] {
    return (this.db
      .prepare("SELECT * FROM attempts WHERE status IN ('done','cached') AND thumb IS NULL AND outputs_json!='[]'")
      .all() as AttemptRow[]).map(attemptFromRow)
  }
  /** Finished attempts with outputs, newest first, for the Gallery. */
  galleryAttempts(): (Attempt & { shotName: string; shotPosition: number | null; sequenceId: number | null; keeper: number | null })[] {
    const rows = this.db
      .prepare(`SELECT a.*, s.name AS shot_name, s.position AS shot_position, s.sequence_id AS seq_id, s.keeper_attempt_id AS keeper
        FROM attempts a JOIN shots s ON s.id=a.shot_id
        WHERE a.status IN ('done','cached') ORDER BY a.id DESC`)
      .all() as (AttemptRow & { shot_name: string; shot_position: number | null; seq_id: number | null; keeper: number | null })[]
    return rows.map((r) => ({ ...attemptFromRow(r), shotName: r.shot_name, shotPosition: r.shot_position, sequenceId: r.seq_id, keeper: r.keeper }))
  }
  shotsUsingWorkflow(id: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM shots WHERE workflow_id=?').get(id) as { n: number }).n
  }
  shotsUsingKey(key: string): number {
    const rows = this.db.prepare('SELECT values_json FROM shots').all() as { values_json: string }[]
    return rows.filter((r) => {
      const v = parse<Record<string, unknown>>(r.values_json, {})[key]
      return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
    }).length
  }

  // prompt chat
  chat(shotId: number): ChatMessage[] {
    const rows = this.db.prepare('SELECT * FROM chat_messages WHERE shot_id=? ORDER BY id').all(shotId) as
      { id: number; role: string; text: string; images_json: string; created_at: string }[]
    return rows.map((r) => ({
      id: r.id, role: r.role === 'assistant' ? 'assistant' : 'user', text: r.text, images: parse<string[]>(r.images_json, []), createdAt: r.created_at
    }))
  }
  addChatMessage(shotId: number, role: ChatMessage['role'], text: string, images: string[] = []): void {
    this.db.prepare('INSERT INTO chat_messages(shot_id,role,text,images_json,created_at) VALUES(?,?,?,?,?)').run(shotId, role, text, JSON.stringify(images), now())
  }
  clearChat(shotId: number): void {
    this.db.prepare('DELETE FROM chat_messages WHERE shot_id=?').run(shotId)
  }

  // input files
  addInput(name: string, originalName: string): void {
    this.db.prepare('INSERT OR IGNORE INTO inputs(name,original_name,created_at) VALUES(?,?,?)').run(name, originalName, now())
  }
  inputs(names: string[]): InputFile[] {
    if (!names.length) return []
    const rows = this.db
      .prepare(`SELECT name, original_name FROM inputs WHERE name IN (${names.map(() => '?').join(',')})`)
      .all(...names) as { name: string; original_name: string }[]
    return rows.map((r) => ({ name: r.name, originalName: r.original_name, path: `inputs/${r.name}` }))
  }
  uploadedName(name: string, server: string): string | null {
    return (this.db.prepare('SELECT server_name FROM uploads WHERE name=? AND server=?').get(name, server) as { server_name: string } | undefined)?.server_name ?? null
  }
  markUploaded(name: string, server: string, serverName: string): void {
    this.db.prepare('INSERT OR REPLACE INTO uploads(name,server,server_name) VALUES(?,?,?)').run(name, server, serverName)
  }
  forgetUpload(name: string, server: string): void {
    this.db.prepare('DELETE FROM uploads WHERE name=? AND server=?').run(name, server)
  }
  /** Forgets every upload stored on a server under this name (the file was deleted there). */
  forgetServerFile(server: string, serverName: string): void {
    this.db.prepare('DELETE FROM uploads WHERE server=? AND server_name=?').run(server, serverName)
  }
  serverOf(attemptId: number): string | null {
    return (this.db.prepare('SELECT server_url FROM attempts WHERE id=?').get(attemptId) as { server_url: string | null } | undefined)?.server_url ?? null
  }
}
