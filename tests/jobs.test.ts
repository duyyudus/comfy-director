import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobManager } from '../src/main/jobs'
import { ComfyError, type HistoryEntry, type QueueState } from '../src/core/comfy/client'
import { buildSchema } from '../src/core/workflow'
import type { Attempt, RunRequest } from '../src/shared/types'
import { fl2v } from './fixtures'

const SERVER = 'http://127.0.0.1:8188'
const IMAGE = 'aaaaaaaaaaaaaaaaaaaa.png'

const attempt = (id: number, shotId: number, status: Attempt['status']): Attempt => ({
  id, shotId, num: id, workflowId: 'wf', workflowName: 'wf', workflowVersion: 1, workflowHash: 'h', values: {}, seed: 1,
  status, promptId: `p${id}`, runId: 'r', promptIndex: 0, promptCount: 1, runIndex: 0, runCount: 1, outputs: [], thumb: null,
  mediaDuration: null, error: null, progress: 0, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, renderMs: null, steps: null
})

const history = (file: string): HistoryEntry => ({
  prompt: [],
  outputs: { '9': { images: [{ filename: file, subfolder: '', type: 'output' }] } },
  status: { status_str: 'success', completed: true, messages: [] }
})

const emptyQueue = async (): Promise<QueueState> => ({ queue_running: [], queue_pending: [] })

interface Fakes {
  attempts?: Attempt[]
  /** Server each attempt was sent to (default: the connected one). */
  sentTo?: string
  uploaded?: string[]
  client?: Record<string, unknown>
}

/** A JobManager over an in-memory project: just enough of Workspace, ProjectDb and ServerManager. */
function setup(dir: string, f: Fakes) {
  const rows = new Map((f.attempts ?? []).map((a) => [a.id, a]))
  const uploads = new Set(f.uploaded ?? [])
  let nextNum = rows.size + 1
  const pdb = {
    db: { prepare: () => ({ get: () => ({ n: nextNum }), run: (n: number) => (nextNum = n) }) },
    serverOf: () => f.sentTo ?? SERVER,
    activeAttempts: () => [...rows.values()],
    attempt: (id: number) => rows.get(id) ?? null,
    // two loose shots with the same name share an output folder
    shot: (id: number) => ({ id, name: 'Untitled shot', sequenceId: null, position: null }),
    sequence: () => null,
    finalJson: () => '{}',
    updateShot: () => {},
    updateAttempt: (id: number, patch: Partial<Attempt>) => {
      const next = { ...rows.get(id)!, ...patch }
      rows.set(id, next)
      return next
    },
    createAttempt: (a: { shotId: number }) => {
      const created = { ...attempt(nextNum, a.shotId, 'submitting'), promptId: null }
      nextNum++
      rows.set(created.id, created)
      return created
    },
    deleteAttempt: (id: number) => rows.delete(id),
    uploadedName: (name: string) => (uploads.has(name) ? name : null),
    markUploaded: (name: string) => uploads.add(name),
    forgetUpload: (name: string) => uploads.delete(name)
  }
  const workflow = fl2v()
  const ws = {
    projectPaths: () => [dir],
    project: () => pdb,
    projectName: () => 'Project',
    loadWorkflow: () => ({ row: { id: 'wf', name: 'wf', version: 1, hash: 'h' }, workflow, overrides: {} })
  }
  const client = {
    getQueue: emptyQueue,
    getHistory: async () => null,
    view: async (file: { filename: string }) => new TextEncoder().encode(file.filename).buffer,
    deleteQueued: async () => {},
    interrupt: async () => {},
    ...f.client
  }
  const server = Object.assign(new EventEmitter(), { client, connected: true, url_: SERVER, objectInfo: null })
  const jobs = new JobManager(() => ws as never, server as never, () => {})
  jobs.loadActive()
  return { jobs, rows, uploads }
}

/** A Run of the first/last-frame workflow with one image in every file input. */
function request(runs = 1): { req: RunRequest; fileNodeId: string } {
  const schema = buildSchema(fl2v(), {}, null)
  const values: Record<string, unknown> = {}
  let fileNodeId = ''
  for (const i of schema.inputs) {
    if (i.type === 'file') {
      values[i.key] = IMAGE
      if (i.target.kind === 'file') fileNodeId ||= i.target.nodeId
    } else if (i.type === 'file-group') values[i.key] = [IMAGE]
    else values[i.key] = i.default
  }
  expect(fileNodeId).not.toBe('')
  return { req: { workflowId: 'wf', values, promptMode: 'single', prompts: [], runs, seedMode: 'random', seedValue: null }, fileNodeId }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ct-jobs-'))
  mkdirSync(join(dir, 'inputs'))
  writeFileSync(join(dir, 'inputs', IMAGE), 'png')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('JobManager.reconcile', () => {
  it('leaves a job alone when the history request fails', async () => {
    const { jobs, rows } = setup(dir, {
      attempts: [attempt(1, 1, 'running')],
      client: {
        getHistory: async () => {
          throw new ComfyError("Can't reach the server: timeout", 0)
        }
      }
    })
    await jobs.reconcile()
    expect(rows.get(1)!.status).toBe('running')
    expect(rows.get(1)!.error).toBeNull()
  })

  it('fails a job the server has no record of', async () => {
    const { jobs, rows } = setup(dir, { attempts: [attempt(1, 1, 'running')] })
    await jobs.reconcile()
    expect(rows.get(1)!.status).toBe('failed')
  })

  it('keeps the files of same-named shots apart and never overwrites one', async () => {
    const out = join(dir, 'outputs/_loose/Untitled shot')
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'attempt-1-wf.mp4'), 'older render')
    const { jobs, rows } = setup(dir, {
      attempts: [attempt(1, 1, 'queued'), attempt(2, 2, 'queued')],
      client: { getHistory: async (pid: string) => history(`${pid}.mp4`) }
    })
    await jobs.reconcile()
    expect(rows.get(1)!.outputs[0].path).toBe('outputs/_loose/Untitled shot/attempt-1-wf (2).mp4')
    expect(rows.get(2)!.outputs[0].path).toBe('outputs/_loose/Untitled shot/attempt-2-wf.mp4')
    expect(readFileSync(join(out, 'attempt-1-wf.mp4'), 'utf8')).toBe('older render')
    expect(readFileSync(join(dir, rows.get(1)!.outputs[0].path), 'utf8')).toBe('p1.mp4')
    expect(existsSync(join(dir, rows.get(2)!.outputs[0].path))).toBe(true)
  })

  it("takes the render time from the server's timestamps", async () => {
    const h = history('p1.mp4')
    h.status!.messages = [['execution_start', { timestamp: 1_000_000 }], ['execution_success', { timestamp: 1_125_400 }]]
    const { jobs, rows } = setup(dir, {
      // a local start stamp far in the past must not win over the server's figure
      attempts: [{ ...attempt(1, 1, 'running'), startedAt: new Date(Date.now() - 3_600_000).toISOString() }],
      client: { getHistory: async () => h }
    })
    await jobs.reconcile()
    expect(rows.get(1)!.renderMs).toBe(125_400)
  })

  it('measures the render time locally when the history has no timestamps', async () => {
    const { jobs, rows } = setup(dir, {
      attempts: [{ ...attempt(1, 1, 'running'), startedAt: new Date(Date.now() - 60_000).toISOString() }],
      client: { getHistory: async () => history('p1.mp4') }
    })
    await jobs.reconcile()
    expect(rows.get(1)!.renderMs).toBeGreaterThanOrEqual(60_000)
    expect(rows.get(1)!.renderMs).toBeLessThan(70_000)
  })

  it('leaves the download out of the locally measured render time', async () => {
    const { jobs, rows } = setup(dir, {
      attempts: [{ ...attempt(1, 1, 'running'), startedAt: new Date(Date.now() - 1000).toISOString() }],
      client: {
        getHistory: async () => history('p1.mp4'),
        view: async () => {
          await new Promise((r) => setTimeout(r, 600))
          return new ArrayBuffer(1)
        }
      }
    })
    await jobs.reconcile()
    expect(rows.get(1)!.renderMs).toBeGreaterThanOrEqual(1000)
    expect(rows.get(1)!.renderMs).toBeLessThan(1500)
  })

  it('tries a failed download again, then gives up', async () => {
    let fails = 1
    const view = async (file: { filename: string }): Promise<ArrayBuffer> => {
      if (fails-- > 0) throw new ComfyError("Can't reach the server: reset", 0)
      return new TextEncoder().encode(file.filename).buffer as ArrayBuffer
    }
    const { jobs, rows } = setup(dir, { attempts: [attempt(1, 1, 'running')], client: { getHistory: async () => history('a.mp4'), view } })
    await jobs.reconcile()
    expect(rows.get(1)!.status).toBe('running')
    await jobs.reconcile()
    expect(rows.get(1)!.status).toBe('done')

    fails = Infinity
    const second = setup(dir, { attempts: [attempt(1, 1, 'running')], client: { getHistory: async () => history('a.mp4'), view } })
    for (let i = 0; i < 3; i++) await second.jobs.reconcile()
    expect(second.rows.get(1)!.status).toBe('failed')
  })
})

describe('JobManager.run', () => {
  it('uploads a remembered image again when the server rejects it', async () => {
    const { req, fileNodeId } = request()
    const uploadedNow: string[] = []
    let posts = 0
    const { jobs } = setup(dir, {
      uploaded: [IMAGE],
      client: {
        uploadImage: async (name: string) => {
          uploadedNow.push(name)
          return { name, subfolder: '', type: 'input' }
        },
        queuePrompt: async () => {
          if (posts++ === 0) {
            throw new ComfyError('Server answered 400.', 400, {
              error: { message: 'Prompt outputs failed validation' },
              node_errors: { [fileNodeId]: { class_type: 'LoadImage', errors: [{ type: 'custom_validation_failed', message: 'Invalid image file', extra_info: { input_name: 'image' } }] } }
            })
          }
          return { prompt_id: 'p-ok', number: 1 }
        }
      }
    })
    const res = await jobs.run(dir, 1, req)
    expect(res.ok).toBe(true)
    expect(uploadedNow).toEqual([IMAGE])
    expect(posts).toBe(2)
  })

  it('says so when a queued job could not be taken back', async () => {
    const { req } = request(2)
    let posts = 0
    const { jobs, rows } = setup(dir, {
      uploaded: [IMAGE],
      client: {
        queuePrompt: async () => {
          if (posts++ === 0) return { prompt_id: 'p-first', number: 1 }
          throw new ComfyError('Server answered 500.', 500)
        },
        // the server ignores the delete: the first job is still waiting
        getQueue: async () => ({ queue_running: [], queue_pending: [[1, 'p-first', {}, {}, []]] })
      }
    })
    const res = await jobs.run(dir, 1, req)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('1 job already queued could not be removed')
    expect(res.message).not.toContain('Nothing was queued')
    expect([...rows.values()].map((a) => [a.promptId, a.status])).toEqual([['p-first', 'queued']])
  })

  it('reports nothing queued when the rollback worked', async () => {
    const { req } = request(2)
    let posts = 0
    const { jobs, rows } = setup(dir, {
      uploaded: [IMAGE],
      client: {
        queuePrompt: async () => {
          if (posts++ === 0) return { prompt_id: 'p-first', number: 1 }
          throw new ComfyError('Server answered 500.', 500)
        }
      }
    })
    const res = await jobs.run(dir, 1, req)
    expect(res.message).toContain('Nothing was queued.')
    expect(rows.size).toBe(0)
  })
})

describe('JobManager.cancelAttempt', () => {
  it('stops tracking an attempt that was sent to another server', async () => {
    const { jobs, rows } = setup(dir, { attempts: [attempt(1, 1, 'queued')], sentTo: 'http://old-server:8188' })
    await jobs.cancelAttempt(dir, 1)
    expect(rows.get(1)!.status).toBe('cancelled')
    expect(rows.get(1)!.error?.message).toContain('http://old-server:8188')
  })
})
