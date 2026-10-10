import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { timeAgo } from '../lib/format'
import { Button, Chip, Dialog, Progress, Tag } from './ui'
import type { FinishedJob, QueueJob } from '@shared/types'

export function QueueStrip(): ReactNode {
  const { queue, queueOpen, setQueueOpen } = useStore()
  const r = queue.running
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={queueOpen}
      title={queueOpen ? 'Collapse queue' : 'Open queue'}
      className="flex h-16 shrink-0 cursor-pointer items-center gap-4 border-t border-border bg-panel px-6 select-none hover:bg-stripe"
      onClick={() => setQueueOpen(!queueOpen)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        setQueueOpen(!queueOpen)
      }}
    >
      <span className="font-semibold">Queue</span>
      {r ? (
        <>
          <span className="max-w-[40%] truncate text-text2">
            Running: {r.ours ? `#${r.attemptNum} ${r.shotName}` : 'job from another client'}
            {r.ours ? ` · ${r.progress ?? 0}%` : ''}
          </span>
          <Progress value={r.ours ? r.progress ?? 0 : 0} className="min-w-24 flex-1" />
        </>
      ) : (
        <span className="flex-1 text-text2">{queue.waiting.length ? 'Starting…' : 'Idle'}</span>
      )}
      <span className="text-text2">{queue.waiting.length ? `${queue.waiting.length} waiting` : ''}</span>
      <span className="w-5 text-center text-sm text-text2">{queueOpen ? '▾' : '▴'}</span>
    </div>
  )
}

interface Group {
  runId: string | null
  jobs: (QueueJob & { position: number })[]
}

const QUEUE_OUT_MS = 120

/** Keeps the drawer mounted while it animates closed. */
export function QueueDrawer(): ReactNode {
  const { queueOpen } = useStore()
  const [mounted, setMounted] = useState(queueOpen)
  useEffect(() => {
    if (queueOpen) {
      setMounted(true)
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => setMounted(false), reduced ? 0 : QUEUE_OUT_MS)
    return () => clearTimeout(t)
  }, [queueOpen])
  if (!mounted && !queueOpen) return null
  return <DrawerPanel closing={!queueOpen} />
}

function DrawerPanel({ closing }: { closing: boolean }): ReactNode {
  const { queue, setQueueOpen, tree, go, toast } = useStore()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [confirmOther, setConfirmOther] = useState<string | null>(null)
  const [details, setDetails] = useState<FinishedJob | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const groups: Group[] = []
  queue.waiting.forEach((j, i) => {
    const job = { ...j, position: i + 1 }
    const last = groups[groups.length - 1]
    if (j.ours && j.runId && last && last.runId === j.runId) last.jobs.push(job)
    else groups.push({ runId: j.ours ? j.runId ?? null : null, jobs: [job] })
  })

  const openShot = (projectPath: string | undefined, shotId: number | undefined): void => {
    if (!projectPath || shotId === undefined) return
    if (tree?.project.path !== projectPath) {
      toast('That shot belongs to another project. Switch project to open it.')
      return
    }
    setQueueOpen(false)
    go({ name: 'shot', shotId })
  }

  const projectLabel = (j: { projectPath?: string; projectName?: string }): ReactNode =>
    j.projectPath && j.projectPath !== tree?.project.path ? <span className="text-xs text-muted">[{j.projectName}]</span> : null

  const r = queue.running
  const elapsed = r?.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(r.startedAt)) / 1000)) : null

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-16 top-[28%] z-30 flex flex-col border-t border-border bg-panel shadow-[0_-8px_30px_rgba(0,0,0,0.12)]',
        closing ? 'queue-out' : 'queue-in'
      )}
    >
      <div
        role="button"
        tabIndex={0}
        title="Collapse queue"
        className="flex cursor-pointer items-center gap-4 border-b border-border px-6 py-4 select-none hover:bg-stripe"
        onClick={() => setQueueOpen(false)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          setQueueOpen(false)
        }}
      >
        <span className="text-17 font-semibold">Queue</span>
        <span className="flex-1 text-text2">
          {r ? 1 : 0} running · {queue.waiting.length} waiting. The server runs jobs in the order it received them. Jobs from other clients are
          never cancelled in bulk.
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          <Button disabled={!queue.ourWaitingCount} onClick={() => void act(() => api.cancelAllWaiting())}>
            Cancel all waiting ({queue.ourWaitingCount})
          </Button>
        </span>
        <span className="w-5 text-center text-sm text-text2">▾</span>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6 scroll-thin">
        {!r && !queue.waiting.length && !queue.finished.length && (
          <div className="py-10 text-center text-text2">Nothing running, nothing waiting.</div>
        )}

        {r && (
          <>
            <Heading>Running</Heading>
            <div className="flex items-center gap-4 rounded-lg border border-accent bg-panel p-3">
              <div className="flex size-14 shrink-0 items-center justify-center rounded bg-fill text-13 text-text2">
                {r.ours ? `${r.progress ?? 0}%` : '…'}
              </div>
              <div className="min-w-0 flex-1">
                {r.ours ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="font-semibold underline underline-offset-2" onClick={() => openShot(r.projectPath, r.shotId)}>
                        {r.shotName} · #{r.attemptNum}
                      </button>
                      <Chip>{r.workflowName}</Chip>
                      <Tag kind="running">Running</Tag>
                      {projectLabel(r)}
                    </div>
                    <div className="mt-1 text-13 text-text2">{r.note}</div>
                    <Progress value={r.progress ?? 0} className="mt-2" />
                    <div className="mt-1.5 text-13 text-text2">
                      {r.stage}
                      {elapsed !== null && ` · ${fmtElapsed(elapsed)} so far`}
                    </div>
                  </>
                ) : (
                  <div>
                    <div className="font-semibold">Started from another client</div>
                    <div className="font-mono text-xs text-muted">prompt {r.promptId.slice(0, 8)}…</div>
                  </div>
                )}
              </div>
              {r.ours && <Button onClick={() => void act(() => api.interrupt(r.promptId))}>Interrupt</Button>}
            </div>
          </>
        )}

        {queue.waiting.length > 0 && <Heading>Waiting ({queue.waiting.length})</Heading>}
        {groups.map((g, gi) => {
          if (!g.runId || g.jobs.length === 1) {
            return g.jobs.map((j) => (
              <WaitingRow key={j.promptId} job={j} onOpen={() => openShot(j.projectPath, j.shotId)} project={projectLabel(j)}
                onCancel={() => (j.ours ? void act(() => api.cancelJobs([j.promptId])) : setConfirmOther(j.promptId))} />
            ))
          }
          const first = g.jobs[0]
          const key = `${g.runId}-${gi}`
          const isCollapsed = collapsed.has(key)
          return (
            <div key={key} className="mt-1">
              <div className="flex items-center gap-3 rounded-md bg-stripe px-3 py-2.5">
                <button
                  className="w-5 text-sm"
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  onClick={() => {
                    const n = new Set(collapsed)
                    if (isCollapsed) n.delete(key)
                    else n.add(key)
                    setCollapsed(n)
                  }}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <span className="font-semibold">{first.shotName}</span>
                <span className="text-text2">
                  {first.workflowName} · {first.runLabel} · positions {first.position} to {g.jobs[g.jobs.length - 1].position}
                </span>
                {projectLabel(first)}
                <span className="flex-1" />
                <Button size="sm" onClick={() => void act(() => api.cancelJobs(g.jobs.map((j) => j.promptId)))}>
                  Cancel remaining ({g.jobs.length})
                </Button>
              </div>
              {!isCollapsed &&
                g.jobs.map((j) => (
                  <WaitingRow key={j.promptId} job={j} onOpen={() => openShot(j.projectPath, j.shotId)} project={null}
                    onCancel={() => void act(() => api.cancelJobs([j.promptId]))} />
                ))}
            </div>
          )
        })}

        {queue.finished.length > 0 && (
          <Heading>
            Finished recently <span className="ml-2 tracking-normal normal-case">Kept for this session. Older attempts live in the shot and the Gallery.</span>
          </Heading>
        )}
        {queue.finished.map((f) => (
          <div key={`${f.projectPath}-${f.attemptId}-${f.finishedAt}`} className="flex items-center gap-4 border-b border-border py-3">
            <span className="w-24 shrink-0">
              <Tag kind={f.status}>{f.status === 'done' ? 'Done' : f.status}</Tag>
            </span>
            <span className="min-w-0 flex-1 truncate">
              {f.shotName} · #{f.attemptNum} <Chip className="mx-1">{f.workflowName}</Chip>
              <span className="text-13 text-text2">
                {timeAgo(f.finishedAt)} · {f.note}
              </span>
            </span>
            {f.status === 'failed' ? (
              <Button size="sm" onClick={() => setDetails(f)}>Details</Button>
            ) : (
              <Button size="sm" onClick={() => openShot(f.projectPath, f.shotId)}>Open shot</Button>
            )}
          </div>
        ))}
      </div>

      <Dialog
        open={!!confirmOther}
        onClose={() => setConfirmOther(null)}
        title="Cancel a job from another client?"
        footer={
          <>
            <Button onClick={() => setConfirmOther(null)}>Keep it</Button>
            <Button variant="danger" onClick={() => {
              const id = confirmOther!
              setConfirmOther(null)
              void act(() => api.cancelOtherClientJob(id))
            }}>Cancel job</Button>
          </>
        }
      >
        This job was not started from this app. Someone else may be waiting for it.
      </Dialog>
      <Dialog
        open={!!details}
        onClose={() => setDetails(null)}
        title={`${details?.shotName} · #${details?.attemptNum} failed`}
        width={640}
        footer={
          <>
            <Button onClick={() => void api.copyText(details?.error?.details || details?.error?.message || '')}>Copy details</Button>
            <Button onClick={() => (openShot(details?.projectPath, details?.shotId), setDetails(null))}>Open shot</Button>
          </>
        }
      >
        <div>{details?.error?.message}</div>
        {details?.error?.nodeType && (
          <div className="mt-1 text-13 text-text2">
            Node {details.error.nodeId} · {details.error.nodeType} {details.error.errorType && `· ${details.error.errorType}`}
          </div>
        )}
        {details?.error?.details && (
          <pre className="mt-3 max-h-64 overflow-auto rounded bg-fill p-3 font-mono text-xs whitespace-pre-wrap text-text2">{details.error.details}</pre>
        )}
      </Dialog>
    </div>
  )
}

function WaitingRow({ job, onCancel, onOpen, project }: { job: QueueJob & { position: number }; onCancel: () => void; onOpen: () => void; project: ReactNode }): ReactNode {
  return (
    <div className={cn('flex items-center gap-4 border-b border-border px-3 py-2.5', !job.ours && 'bg-stripe')}>
      <span className="w-12 shrink-0 font-mono text-13 text-text2">{job.position === 1 ? 'Next' : job.position}</span>
      <span className="min-w-0 flex-1 truncate">
        {job.ours ? (
          <>
            <button className="hover:underline" onClick={onOpen}>{job.shotName} · #{job.attemptNum}</button>
            <Chip className="mx-2">{job.workflowName}</Chip>
            <span className="text-13 text-text2">{job.note}</span> {project}
          </>
        ) : (
          <>
            <span className="font-semibold">Started from another client</span>{' '}
            <span className="font-mono text-xs text-text2">prompt {job.promptId.slice(0, 6)}…</span>{' '}
            <span className="text-13 text-text2">Cancelling asks first.</span>
          </>
        )}
      </span>
      <Button size="sm" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

function Heading({ children }: { children: ReactNode }): ReactNode {
  return <div className="mt-5 mb-2 text-11 tracking-[0.12em] text-muted uppercase">{children}</div>
}

function fmtElapsed(s: number): string {
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}
