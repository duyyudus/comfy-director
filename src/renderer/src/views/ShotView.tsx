import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SchemaInput } from '@core/workflow/types'
import type { Attempt, InputFile, PromptMode, SeedMode, Shot, ShotDetail, UploadFailure, WorkflowInfo } from '@shared/types'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { attemptSummary, pad2, plural, timeAgo } from '../lib/format'
import { Button, Card, Chip, Dialog, Empty, Input, Label, Menu, MenuItem, Progress, SectionLabel, Segmented, Select, Tag, Textarea } from '../components/ui'
import { InputControl, fileHint } from '../components/inputs'
import { PlayerDialog, Thumb } from '../components/Media'
import { PromptListEditor } from './PromptList'
import { PromptChat } from './PromptChat'

/** Whether the Prompt chat panel is open, kept while moving between shots and back from Compare. */
let chatWasOpen = true

interface Form {
  workflowId: string | null
  values: Record<string, unknown>
  promptMode: PromptMode
  promptList: string[]
  seedMode: SeedMode
  seedValue: number | null
  runs: number
}

const formOf = (s: Shot): Form => ({
  workflowId: s.workflowId,
  values: s.values,
  promptMode: s.promptMode,
  promptList: s.promptList,
  seedMode: s.seedMode,
  seedValue: s.seedValue ?? s.lastSeed,
  runs: s.runs
})

export function ShotView({ shotId }: { shotId: number }): ReactNode {
  const { tree, workflows, server, queue, lastAttempt, projectVersion, pendingLoad, setPendingLoad, go, toast, refreshTree } = useStore()
  const projectPath = tree?.project.path ?? ''
  const [detail, setDetail] = useState<ShotDetail | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [limit, setLimit] = useState(20)
  const [files, setFiles] = useState<Record<string, InputFile>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploadFailures, setUploadFailures] = useState<UploadFailure[]>([])
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [moveOpen, setMoveOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [playing, setPlaying] = useState<Attempt | null>(null)
  const [saveLibOpen, setSaveLibOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(chatWasOpen)
  const showChat = (v: boolean): void => {
    chatWasOpen = v
    setChatOpen(v)
  }
  const formShot = useRef<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatch = useRef<Partial<Shot>>({})

  const deleting = useRef(false)

  const load = useCallback(async () => {
    if (!projectPath || deleting.current) return
    try {
      const d = await api.getShot(projectPath, shotId, limit)
      setDetail(d)
      setFiles((f) => ({ ...f, ...d.inputs }))
      if (formShot.current !== shotId) {
        formShot.current = shotId
        setForm(formOf(d.shot))
        setErrors({})
        setUploadFailures([])
        setRunMessage(null)
        setSelected([])
      }
    } catch (e) {
      toast(errorMessage(e), 'error')
      go({ name: 'home' })
    }
  }, [projectPath, shotId, limit, toast, go])

  useEffect(() => {
    void load()
  }, [load, projectVersion])

  useEffect(() => {
    if (lastAttempt && lastAttempt.projectPath === projectPath && lastAttempt.attempt.shotId === shotId) void load()
  }, [lastAttempt, projectPath, shotId, load])

  // Persist edits shortly after typing stops.
  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const patch = pendingPatch.current
    pendingPatch.current = {}
    if (Object.keys(patch).length && projectPath) await api.updateShot(projectPath, shotId, patch)
  }, [projectPath, shotId])
  useEffect(() => () => void flush(), [flush])

  const update = (patch: Partial<Form>): void => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    pendingPatch.current = { ...pendingPatch.current, ...patch }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), 400)
  }
  const setValue = (key: string, v: unknown): void => {
    if (!form) return
    update({ values: { ...form.values, [key]: v } })
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest)
  }

  const activeWf: WorkflowInfo | undefined = workflows.find((w) => w.id === form?.workflowId) ?? workflows[0]

  // Load settings from Gallery / Compare / Library.
  useEffect(() => {
    if (pendingLoad && pendingLoad.shotId === shotId && form) {
      const listRun = form.promptMode === 'list'
      update({
        workflowId: pendingLoad.workflowId,
        values: { ...form.values, ...pendingLoad.values },
        ...(pendingLoad.seed !== null && { seedValue: pendingLoad.seed }),
        ...(listRun && 'prompt' in pendingLoad.values && { promptMode: 'single' as const })
      })
      setPendingLoad(null)
      toast('Settings loaded into the form.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLoad, shotId, form === null])

  const loadSettings = (a: Attempt): void =>
    setPendingLoad({ shotId, workflowId: a.workflowId, values: a.values, seed: a.seed })

  // Keys shared by all workflows come first; others go below an "OTHER INPUTS" divider.
  const { prompt, shared, other } = useMemo(() => {
    const inputs = activeWf?.inputs ?? []
    const isShared = (i: SchemaInput): boolean => workflows.every((w) => w.inputs.some((x) => x.key === i.key))
    return {
      prompt: inputs.find((i) => i.key === 'prompt' && i.type === 'text'),
      shared: inputs.filter((i) => !(i.key === 'prompt' && i.type === 'text') && isShared(i)),
      other: inputs.filter((i) => !(i.key === 'prompt' && i.type === 'text') && !isShared(i))
    }
  }, [activeWf, workflows])

  if (!tree || !detail || !form) return <div className="p-8 text-text2">Loading…</div>
  const shot = detail.shot
  const listMode = form.promptMode === 'list' && !!prompt
  const promptCount = listMode ? form.promptList.filter((p) => p.trim()).length : 1
  const jobs = promptCount * Math.max(1, form.runs || 1)
  const keeper = detail.attempts.find((a) => a.id === shot.keeperAttemptId)
  const offline = server.state !== 'connected'
  const shotImages = (activeWf?.inputs ?? [])
    .flatMap((i) => (i.type === 'file' || i.type === 'file-group' ? [form.values[i.key]].flat() : []))
    .filter((v): v is string => typeof v === 'string' && !!v)
    .map((name) => files[name] ?? { name, originalName: name, path: `inputs/${name}` })

  const run = async (): Promise<void> => {
    if (!activeWf) return
    setSubmitting(true)
    setRunMessage(null)
    try {
      await flush()
      const res = await api.run(projectPath, shotId, {
        workflowId: activeWf.id,
        values: form.values,
        promptMode: listMode ? 'list' : 'single',
        prompts: form.promptList,
        runs: form.runs,
        seedMode: form.seedMode,
        seedValue: form.seedValue
      })
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {})
        setUploadFailures(res.uploadFailures ?? [])
        setRunMessage(res.message ?? 'Nothing was queued.')
      } else {
        setErrors({})
        setUploadFailures([])
        const last = res.attempts?.[res.attempts.length - 1]
        if (last && form.seedMode === 'random') setForm((f) => (f ? { ...f, seedValue: last.seed } : f))
        if (shot.workflowId !== activeWf.id) await api.updateShot(projectPath, shotId, { workflowId: activeWf.id })
        await load()
        await refreshTree()
      }
    } catch (e) {
      setRunMessage(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const renderInput = (i: SchemaInput): ReactNode => (
    <InputControl
      key={i.key}
      input={i}
      value={i.key in form.values ? form.values[i.key] : i.default}
      onChange={(v) => setValue(i.key, v)}
      error={errors[i.key]}
      projectPath={projectPath}
      files={files}
      onFiles={(f) => setFiles((x) => ({ ...x, ...Object.fromEntries(f.map((y) => [y.name, y])) }))}
      uploadFailure={uploadFailures.find((u) => u.key === i.key)}
      onRetryUpload={() => void run()}
    />
  )

  const renderGroup = (inputs: SchemaInput[]): ReactNode => {
    const blocks: ReactNode[] = []
    let row: SchemaInput[] = []
    const flushRow = (): void => {
      if (row.length) blocks.push(<div key={`row-${row[0].key}`} className="flex flex-wrap items-start gap-5">{row.map(renderInput)}</div>)
      row = []
    }
    const fileSingles = inputs.filter((i) => i.type === 'file')
    for (const i of inputs) {
      if (i.type === 'number' || i.type === 'select') row.push(i)
      else if (i.type === 'file') continue
      else {
        flushRow()
        blocks.push(<div key={i.key}>{renderInput(i)}</div>)
      }
    }
    flushRow()
    if (fileSingles.length) {
      const hint = fileHint(fileSingles)
      blocks.push(
        <div key="files">
          <div className="flex flex-wrap gap-5">{fileSingles.map(renderInput)}</div>
          {hint && <div className="mt-2 text-13 text-text2">{hint}</div>}
        </div>
      )
    }
    return blocks
  }

  const breadcrumb = [
    detail.sequence ? detail.sequence.name : 'Loose shots',
    detail.sequence ? `Shot ${pad2(shot.position)}` : null,
    keeper || shot.keeperAttemptId ? `keeper #${keeper?.num ?? '?'}` : 'no keeper yet',
    plural(detail.totalAttempts, 'attempt')
  ].filter(Boolean)

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-4 border-b border-border bg-panel px-6 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">
            {detail.sequence ? (
              <button className="hover:underline" onClick={() => go({ name: 'sequence', sequenceId: detail.sequence!.id })}>{breadcrumb[0]}</button>
            ) : breadcrumb[0]}
            {' / '}
            {breadcrumb.slice(1).join(' · ')}
          </div>
          <ShotName key={shot.id} name={shot.name} onSave={async (n) => {
            await api.updateShot(projectPath, shotId, { name: n })
            await load()
          }} />
        </div>
        <Button onClick={async () => {
          try {
            const s = await api.duplicateShot(projectPath, shotId)
            await refreshTree()
            go({ name: 'shot', shotId: s.id })
          } catch (e) {
            toast(errorMessage(e), 'error')
          }
        }}>Duplicate shot</Button>
        <Button onClick={() => setMoveOpen(true)}>Move to sequence</Button>
        <div className="relative">
          <Button variant="ghost" aria-label="More" onClick={() => setMoreOpen(!moreOpen)}>⋯</Button>
          <Menu open={moreOpen} onClose={() => setMoreOpen(false)} className="top-11 right-0">
            <MenuItem danger onClick={async () => {
              setMoreOpen(false)
              if (!confirm(`Delete "${shot.name}" and its ${detail.totalAttempts} attempt records? Rendered files stay in the project folder.`)) return
              // The delete refreshes the tree while this view is still mounted; don't refetch the shot.
              deleting.current = true
              // Land on the neighbour in the sidebar's order: next shot, else previous, else the sequence itself.
              const siblings = (tree?.shots ?? []).filter((s) => s.sequenceId === shot.sequenceId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              const at = siblings.findIndex((s) => s.id === shotId)
              const neighbour = at < 0 ? undefined : siblings[at + 1] ?? siblings[at - 1]
              try {
                await api.deleteShot(projectPath, shotId)
              } catch (e) {
                deleting.current = false
                toast(errorMessage(e), 'error')
                return
              }
              if (neighbour) go({ name: 'shot', shotId: neighbour.id })
              else if (shot.sequenceId !== null) go({ name: 'sequence', sequenceId: shot.sequenceId })
              else go({ name: 'home' })
              await refreshTree()
            }}>Delete shot</MenuItem>
          </Menu>
        </div>
      </div>

      {/* Workflow tabs */}
      <div className="flex items-end gap-1 border-b border-border px-6 pt-3">
        {workflows.map((w) => (
          <button
            key={w.id}
            onClick={() => update({ workflowId: w.id })}
            className={cn(
              '-mb-px rounded-t-md border px-4 py-2.5',
              activeWf?.id === w.id ? 'border-border border-b-bg bg-bg font-semibold' : 'border-transparent text-text2 hover:text-text'
            )}
          >
            {w.name}
          </button>
        ))}
        <button className="px-4 py-2.5 text-text2 hover:text-text" onClick={() => go({ name: 'import', back: { name: 'shot', shotId } })}>
          + Import workflow
        </button>
        <span className="flex-1" />
        {workflows.length > 1 && <span className="pb-2.5 text-13 text-text2">Shared values carry over when you switch</span>}
        {activeWf && (
          <button className="pb-2.5 pl-3 text-13 text-accent-text hover:underline" onClick={() => go({ name: 'import', back: { name: 'shot', shotId }, editId: activeWf.id })}>
            Edit workflow
          </button>
        )}
      </div>

      {!activeWf ? (
        <div className="p-6">
          <Empty
            title="No workflows yet"
            actions={<Button variant="primary" onClick={() => go({ name: 'import', back: { name: 'shot', shotId } })}>Import a workflow</Button>}
          >
            Import an API-format workflow exported from ComfyUI. Its inputs become the form for this shot.
          </Empty>
        </div>
      ) : (
        <div className="flex flex-1 items-start gap-6 p-6">
          {/* Input form */}
          <Card className={cn('flex-[1.25] p-5', chatOpen ? 'min-w-[320px]' : 'min-w-0')}>
            <div className="flex flex-col gap-6">
              {prompt && (
                <div>
                  <div className="mb-1.5 flex items-center gap-3">
                    <span className="text-13">{prompt.label}</span>
                    <span className="flex-1" />
                    {!chatOpen && <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => showChat(true)}>Open prompt chat</Button>}
                    <Segmented
                      size="xs"
                      value={form.promptMode}
                      onChange={(m) => {
                        if (m === 'list' && !form.promptList.length) {
                          const cur = String(form.values.prompt ?? '').trim()
                          update({ promptMode: m, promptList: cur ? [cur] : [''] })
                        } else update({ promptMode: m })
                      }}
                      options={[{ value: 'single', label: 'single' }, { value: 'list', label: 'list' }]}
                    />
                  </div>
                  {listMode ? (
                    <PromptListEditor
                      list={form.promptList}
                      onChange={(l) => update({ promptList: l })}
                      currentPrompt={String(form.values.prompt ?? '')}
                      error={errors.prompt}
                      shotName={shot.name}
                    />
                  ) : (
                    <>
                      <Textarea
                        rows={4}
                        className="min-h-[7.5rem] resize-none [field-sizing:content]"
                        value={String(form.values.prompt ?? (prompt.default as string) ?? '')}
                        invalid={!!errors.prompt}
                        onChange={(e) => setValue('prompt', e.target.value)}
                        placeholder="Describe the shot…"
                      />
                      <div className="mt-1 flex justify-between">
                        <span className="text-13 text-danger">{errors.prompt}</span>
                        <Button variant="link" className="text-13" disabled={!String(form.values.prompt ?? '').trim()} onClick={() => setSaveLibOpen(true)}>
                          Save to Library
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {renderGroup(shared)}

              {activeWf.seedCount > 0 && (
                <div>
                  <Label>Seed</Label>
                  <div className="flex items-center gap-3">
                    <Segmented
                      value={form.seedMode}
                      onChange={(m) => update({ seedMode: m, ...(m === 'fixed' && form.seedValue === null && { seedValue: shot.lastSeed ?? 0 }) })}
                      options={[{ value: 'random', label: 'Random' }, { value: 'fixed', label: 'Fixed' }]}
                    />
                    <Input
                      className="w-[220px] font-mono text-13"
                      readOnly={form.seedMode === 'random'}
                      value={form.seedMode === 'random' ? String(shot.lastSeed ?? form.seedValue ?? '') : String(form.seedValue ?? '')}
                      placeholder={form.seedMode === 'random' ? 'not run yet' : ''}
                      invalid={!!errors.__seed}
                      onChange={(e) => update({ seedValue: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    />
                    <span className="text-13 text-muted">{form.seedMode === 'random' ? 'last seed used' : ''}</span>
                  </div>
                  {errors.__seed && <div className="mt-1.5 text-13 text-danger">{errors.__seed}</div>}
                </div>
              )}

              {other.length > 0 && (
                <>
                  {workflows.length > 1 && <SectionLabel>Other inputs</SectionLabel>}
                  {renderGroup(other)}
                </>
              )}

              {/* Run bar */}
              <div className="border-t border-border pt-5">
                {listMode && (
                  <div className="mb-3 text-13 text-text2">
                    {plural(promptCount, 'prompt')} × {plural(Math.max(1, form.runs || 1), 'run')} = {plural(jobs, 'job')}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <span>{listMode ? 'Runs per prompt' : 'Runs'}</span>
                  <Input
                    type="number"
                    min={1}
                    className="w-[72px]"
                    value={form.runs}
                    onChange={(e) => update({ runs: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                  />
                  <Button variant="primary" size="lg" disabled={offline || submitting || jobs < 1} onClick={() => void run()}>
                    {submitting ? 'Sending…' : `Run ${plural(jobs, 'job')}`}
                  </Button>
                  <span className="text-13 text-text2">
                    {offline ? 'Run is off while the server is offline.' : form.seedMode === 'random' ? 'Random seed gives each run a new take' : 'Fixed seed: identical inputs come back from the cache'}
                  </span>
                </div>
                {runMessage && <div className="mt-3 rounded-md bg-dtint px-3 py-2 text-13 text-danger">{runMessage}</div>}
              </div>
            </div>
          </Card>

          {/* Prompt chat */}
          {chatOpen && (
            <div className="sticky top-6 max-w-[560px] min-w-[360px] flex-1">
              <PromptChat
                projectPath={projectPath}
                shotId={shotId}
                workflowId={activeWf.id}
                currentPrompt={listMode ? '' : String(form.values.prompt ?? '')}
                shotImages={shotImages}
                listMode={listMode}
                onUsePrompt={(t) => {
                  if (listMode) update({ promptList: [...form.promptList.filter((p) => p.trim()), t] })
                  else setValue('prompt', t)
                  toast(listMode ? 'Added to the prompt list.' : 'Prompt replaced.')
                }}
                onClose={() => showChat(false)}
              />
            </div>
          )}

          {/* Attempts */}
          <div className={cn('shrink-0', chatOpen ? 'w-[380px]' : 'w-[460px]')}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-17 font-semibold">
                Attempts <span className="font-normal text-text2">{detail.totalAttempts}</span>
              </div>
              <Button disabled={selected.length < 2 || selected.length > 4} onClick={() => go({ name: 'compare', shotId, attemptIds: selected })}>
                Compare selected{selected.length ? ` (${selected.length})` : ''}
              </Button>
            </div>
            {detail.attempts.length === 0 ? (
              <Empty title="No attempts yet">Fill in the inputs and press Run.</Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {detail.attempts.map((a) => (
                  <AttemptCard
                    key={a.id}
                    a={a}
                    projectPath={projectPath}
                    keeper={shot.keeperAttemptId === a.id}
                    selected={selected.includes(a.id)}
                    onSelect={(v) => setSelected((s) => (v ? [...s, a.id].slice(-4) : s.filter((x) => x !== a.id)))}
                    queuePos={queue.waiting.findIndex((w) => w.attemptId === a.id && w.projectPath === projectPath)}
                    live={queue.running?.attemptId === a.id && queue.running?.projectPath === projectPath ? queue.running : null}
                    onPlay={() => setPlaying(a)}
                    onLoad={() => loadSettings(a)}
                    onKeeper={async () => {
                      await api.setKeeper(projectPath, shotId, a.id)
                      await load()
                    }}
                    onRetry={async (newSeed) => {
                      const r = await api.retryAttempt(projectPath, a.id, newSeed)
                      if (!r.ok) toast(r.message ?? 'Nothing was queued.', 'error')
                      await load()
                    }}
                    onCancel={async () => {
                      try {
                        await api.cancelAttempt(projectPath, a.id)
                      } catch (e) {
                        toast(errorMessage(e), 'error')
                      }
                    }}
                    onDelete={async () => {
                      const isKeeper = shot.keeperAttemptId === a.id
                      if (!confirm(isKeeper ? `#${a.num} is the keeper. Delete it and clear the keeper?` : `Delete attempt #${a.num}? Its file stays in the project folder.`)) return
                      try {
                        await api.deleteAttempt(projectPath, a.id)
                        await load()
                      } catch (e) {
                        toast(errorMessage(e), 'error')
                      }
                    }}
                    offline={offline}
                  />
                ))}
                {detail.totalAttempts > detail.attempts.length && (
                  <button className="py-2 text-left text-text2 hover:text-text" onClick={() => setLimit(10_000)}>
                    Show {detail.totalAttempts - detail.attempts.length} older attempts
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {moveOpen && <MoveDialog shot={shot} onClose={() => setMoveOpen(false)} onDone={load} />}
      <PlayerDialog open={!!playing} onClose={() => setPlaying(null)} title={playing ? `${shot.name} · #${playing.num}` : ''} projectPath={projectPath} attempt={playing} />
      {saveLibOpen && <SaveToLibraryDialog text={String(form.values.prompt ?? '')} defaultName={shot.name} onClose={() => setSaveLibOpen(false)} />}
    </div>
  )
}

function ShotName({ name, onSave }: { name: string; onSave: (n: string) => Promise<void> }): ReactNode {
  const [v, setV] = useState(name)
  useEffect(() => setV(name), [name])
  const commit = (): void => {
    const n = v.trim()
    if (n && n !== name) void onSave(n)
    else setV(name)
  }
  return (
    <input
      aria-label="Shot name"
      className="-ml-1 mt-0.5 w-full rounded border border-transparent bg-transparent px-1 text-22 font-semibold hover:border-border focus:border-control"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(name)
      }}
    />
  )
}

function AttemptCard({ a, projectPath, keeper, selected, onSelect, queuePos, live, onPlay, onLoad, onKeeper, onRetry, onCancel, onDelete, offline }: {
  a: Attempt
  projectPath: string
  keeper: boolean
  selected: boolean
  onSelect: (v: boolean) => void
  queuePos: number
  live: { progress?: number; stage?: string } | null
  onPlay: () => void
  onLoad: () => void
  onKeeper: () => void
  onRetry: (newSeed: boolean) => void
  onCancel: () => void
  onDelete: () => void
  offline: boolean
}): ReactNode {
  const pct = live?.progress ?? a.progress
  const active = a.status === 'running' || a.status === 'queued' || a.status === 'submitting'
  const finished = a.status === 'done' || a.status === 'cached'
  const playable = finished && a.outputs.length > 0
  return (
    <Card
      className={cn('flex gap-3.5 p-3 transition-colors', keeper ? 'border-2 border-accent' : a.status === 'failed' ? 'border-danger/60 hover:border-danger' : 'hover:border-control')}
      title={playable ? 'Double-click to play' : undefined}
      onDoubleClick={(e) => {
        // Double-clicking the card plays it; its buttons and checkbox keep their own clicks.
        if (!playable || (e.target as HTMLElement).closest('button, input')) return
        window.getSelection()?.removeAllRanges()
        onPlay()
      }}
    >
      <Thumb projectPath={projectPath} attempt={finished ? a : null} onPlay={onPlay} className="h-[126px] w-[84px] shrink-0">
        {a.status === 'running' && <span className="text-13 text-text2">{pct}%</span>}
        {a.status === 'queued' && <span className="text-xs text-text2">waiting</span>}
        {a.status === 'failed' && <span className="text-xs font-semibold text-danger">failed</span>}
        {a.status === 'cancelled' && <span className="text-xs text-text2">stopped</span>}
      </Thumb>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <input type="checkbox" aria-label={`Select #${a.num} to compare`} className="size-4 accent-[var(--accent)]" checked={selected} disabled={!finished}
            onChange={(e) => onSelect(e.target.checked)} />
          <span className="font-semibold">#{a.num}</span>
          <Chip>{a.workflowName}</Chip>
          {keeper && <Tag kind="keeper">Keeper</Tag>}
          {a.status === 'cached' && <Tag kind="cached">Cached</Tag>}
          {a.status === 'failed' && <Tag kind="failed">Failed</Tag>}
          {a.status === 'cancelled' && <Tag kind="cancelled">Cancelled</Tag>}
          <span className="flex-1" />
          {!active && (
            <button className="text-xs text-muted hover:text-danger" onClick={onDelete} aria-label={`Delete #${a.num}`}>Delete</button>
          )}
        </div>
        <div className="mt-1 truncate text-13 text-text2">
          {attemptSummary(a)}
          {a.promptCount > 1 && ` · prompt ${a.promptIndex + 1}/${a.promptCount}`}
          {' · '}
          {a.status === 'running' ? live?.stage ?? 'rendering' : a.status === 'queued' ? (queuePos === 0 ? 'next in queue' : queuePos > 0 ? `waiting, position ${queuePos + 1}` : 'waiting') : timeAgo(a.finishedAt ?? a.createdAt)}
        </div>

        {a.status === 'running' && <Progress value={pct} className="mt-2.5" />}
        {a.status === 'failed' && a.error && (
          <div className="mt-2 text-13">
            <div className="line-clamp-2 text-danger">{a.error.message}</div>
            {(a.error.nodeType || a.error.errorType) && (
              <div className="mt-0.5 text-xs text-muted">
                {a.error.nodeType && `${a.error.nodeType} (node ${a.error.nodeId})`} {a.error.errorType && `· ${a.error.errorType}`}
              </div>
            )}
          </div>
        )}
        {a.status === 'cancelled' && <div className="mt-2 text-13 text-text2">{a.error?.message ?? 'Stopped. No video was saved.'}</div>}
        {a.status === 'cached' && (
          <div className="mt-2 text-13 text-text2">
            Finished instantly. The server reused an earlier result because every input, including the seed, was identical.
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap gap-2">
          {active && <Button size="sm" onClick={onCancel} disabled={offline}>Cancel</Button>}
          {a.status === 'cached' && <Button size="sm" disabled={offline} onClick={() => onRetry(true)}>Render again with a new seed</Button>}
          {(a.status === 'failed' || a.status === 'cancelled') && <Button size="sm" disabled={offline} onClick={() => onRetry(false)}>Retry</Button>}
          {!active && <Button size="sm" onClick={onLoad}>Load settings</Button>}
          {finished && !keeper && <Button size="sm" onClick={onKeeper}>Set keeper</Button>}
          {a.status === 'failed' && (
            <Button size="sm" variant="ghost" onClick={() => void api.copyText([a.error?.message, a.error?.nodeType && `Node ${a.error.nodeId} (${a.error.nodeType})`, a.error?.details].filter(Boolean).join('\n'))}>
              Copy details
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

function MoveDialog({ shot, onClose, onDone }: { shot: Shot; onClose: () => void; onDone: () => Promise<void> }): ReactNode {
  const { tree, refreshTree, toast } = useStore()
  const [target, setTarget] = useState<string>(shot.sequenceId !== null ? String(shot.sequenceId) : 'loose')
  const seqShots = tree?.shots.filter((s) => target !== 'loose' && s.sequenceId === Number(target) && s.id !== shot.id) ?? []
  const [pos, setPos] = useState<number>(shot.position ?? seqShots.length + 1)
  useEffect(() => {
    setPos(target !== 'loose' && Number(target) === shot.sequenceId && shot.position ? shot.position : seqShots.length + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  if (!tree) return null
  const save = async (): Promise<void> => {
    try {
      await api.moveShot(tree.project.path, shot.id, target === 'loose' ? null : Number(target), target === 'loose' ? null : pos)
      await refreshTree()
      await onDone()
      onClose()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <Dialog open onClose={onClose} title="Move to sequence"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Move shot</Button></>}>
      <Label>Move "{shot.name}" to</Label>
      <Select className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="loose">Loose shots (no sequence)</option>
        {tree.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {target !== 'loose' && (
        <div className="mt-4">
          <Label>Position</Label>
          <Select className="w-full" value={pos} onChange={(e) => setPos(Number(e.target.value))}>
            {Array.from({ length: seqShots.length + 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {pad2(n)} {n <= seqShots.length ? `(before ${seqShots[n - 1].name})` : '(at the end)'}
              </option>
            ))}
          </Select>
          <div className="mt-1.5 text-13 text-muted">Existing files are not moved. New attempts use the new folder name.</div>
        </div>
      )}
    </Dialog>
  )
}

export function SaveToLibraryDialog({ text, defaultName, onClose }: { text: string; defaultName: string; onClose: () => void }): ReactNode {
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState(defaultName)
  const [tags, setTags] = useState('')
  const save = async (): Promise<void> => {
    await api.savePrompt({ name: name.trim() || 'Untitled prompt', text, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
    toast('Saved to the Library.')
    onClose()
  }
  return (
    <Dialog open onClose={onClose} title="Save prompt to Library"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
      <Label>Name</Label>
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <Label className="mt-4">Tags <span className="text-muted">comma separated</span></Label>
      <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="rooftop, night" />
      <Label className="mt-4">Prompt</Label>
      <div className="max-h-40 overflow-auto rounded-md bg-fill p-3 text-13 text-text2">{text}</div>
    </Dialog>
  )
}
