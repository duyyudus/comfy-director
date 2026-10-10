import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Attempt, ShotDetail } from '@shared/types'
import { diffValues } from '@core/diff'
import { useStore } from '../lib/store'
import { api, media } from '../lib/api'
import { cn } from '../lib/cn'
import { attemptSummary, clock, formatValue, pad2, timeAgo } from '../lib/format'
import { Button, Card, Checkbox, Chip, Menu, MenuItem, Segmented, Select, Tag } from '../components/ui'

export function CompareView({ shotId, attemptIds }: { shotId: number; attemptIds: number[] }): ReactNode {
  const { tree, workflows, go, setPendingLoad, projectVersion } = useStore()
  const projectPath = tree?.project.path ?? ''
  const [detail, setDetail] = useState<ShotDetail | null>(null)
  const [ids, setIds] = useState<number[]>(attemptIds.slice(0, 4))
  const [layout, setLayout] = useState<number>(Math.min(4, Math.max(2, attemptIds.length)))
  const [together, setTogether] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [soundFrom, setSoundFrom] = useState<number | null>(null)
  const [loop, setLoop] = useState(true)
  const [swapOpen, setSwapOpen] = useState<number | null>(null)
  const vids = useRef<(HTMLVideoElement | null)[]>([])

  const load = useCallback(async () => {
    if (projectPath) setDetail(await api.getShot(projectPath, shotId, 10_000))
  }, [projectPath, shotId])
  useEffect(() => {
    void load()
  }, [load, projectVersion])

  const byId = useMemo(() => new Map((detail?.attempts ?? []).map((a) => [a.id, a])), [detail])
  const shown = ids.slice(0, layout).map((id) => byId.get(id)).filter((a): a is Attempt => !!a)
  const finished = (detail?.attempts ?? []).filter((a) => a.status === 'done' || a.status === 'cached')

  // Fill empty slots when the layout grows.
  useEffect(() => {
    if (ids.length >= layout) return
    const extra = finished.filter((a) => !ids.includes(a.id)).slice(0, layout - ids.length).map((a) => a.id)
    if (extra.length) setIds([...ids, ...extra])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, finished.length])

  const each = (fn: (v: HTMLVideoElement) => void): void => vids.current.forEach((v) => v && fn(v))
  useEffect(() => each((v) => (v.playbackRate = speed)), [speed, shown.length])
  useEffect(() => each((v) => (v.loop = loop)), [loop, shown.length])
  useEffect(() => {
    shown.forEach((a, i) => {
      const v = vids.current[i]
      if (v) v.muted = a.id !== soundFrom
    })
  }, [soundFrom, shown])

  const master = (): HTMLVideoElement | null => vids.current.find((v) => v) ?? null
  const toggle = (): void => {
    if (playing) each((v) => v.pause())
    else {
      const t = master()?.currentTime ?? 0
      each((v) => {
        if (together) v.currentTime = Math.min(t, v.duration || t)
        void v.play().catch(() => {})
      })
    }
    setPlaying(!playing)
  }
  const seek = (t: number): void => {
    each((v) => (v.currentTime = Math.min(t, v.duration || t)))
    setTime(t)
  }

  // Keep players on the same time while Play together is on.
  useEffect(() => {
    if (!together || !playing) return
    const h = setInterval(() => {
      const m = master()
      if (!m) return
      each((v) => {
        if (v !== m && Math.abs(v.currentTime - m.currentTime) > 0.15 && m.currentTime < (v.duration || Infinity)) v.currentTime = m.currentTime
      })
    }, 500)
    return () => clearInterval(h)
  }, [together, playing])

  if (!detail) return <div className="p-8 text-text2">Loading…</div>
  const shot = detail.shot
  const labels: Record<string, string> = { __workflow: 'Workflow', __seed: 'Seed' }
  for (const w of workflows) for (const i of w.inputs) labels[i.key] ??= i.label
  const inputOf = (key: string, wfId: string): (typeof workflows)[number]['inputs'][number] | undefined =>
    workflows.find((w) => w.id === wfId)?.inputs.find((i) => i.key === key) ?? workflows.flatMap((w) => w.inputs).find((i) => i.key === key)
  const names = Object.fromEntries(Object.values(detail.inputs).map((f) => [f.name, f.originalName]))
  const diff = diffValues(
    shown.map((a) => ({ values: { __workflow: a.workflowName, ...a.values, __seed: a.seed } })),
    labels,
    (key, v) => {
      if (key === '__workflow') return String(v)
      if (key === '__seed') return `…${String(v).slice(-4)}`
      const input = inputOf(key, shown[0]?.workflowId ?? '')
      if (Array.isArray(v) && v.length) return v.map((n) => names[String(n)] ?? String(n)).join(', ').slice(0, 80)
      return formatValue(input, v, names)
    }
  )

  const setKeeper = async (a: Attempt): Promise<void> => {
    await api.setKeeper(projectPath, shotId, a.id)
    await load()
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-panel px-6 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">
            {detail.sequence ? `${detail.sequence.name} / Shot ${pad2(shot.position)}` : 'Loose shots'} · {shot.name}
          </div>
          <div className="text-20 font-semibold">Compare {shown.length} attempts</div>
        </div>
        <Segmented
          value={String(layout)}
          onChange={(v) => setLayout(Number(v))}
          options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n}-up`, disabled: finished.length < n }))}
        />
        <Checkbox className="mx-2" checked={together} onChange={setTogether} label={<span className="font-normal">Play together</span>} />
        <Button onClick={() => go({ name: 'shot', shotId })}>Close</Button>
      </div>

      <div className="flex-1 p-6">
        <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
          {shown.map((a, i) => {
            const isKeeper = shot.keeperAttemptId === a.id
            const out = a.outputs.find((o) => o.kind === 'video') ?? a.outputs[0]
            return (
              <Card key={`${i}-${a.id}`} className={cn('p-3.5', isKeeper && 'border-2 border-accent')}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-semibold">#{a.num}</span>
                  <Chip>{a.workflowName}</Chip>
                  {isKeeper && <Tag kind="keeper">Keeper</Tag>}
                  <span className="flex-1" />
                  <div className="relative">
                    <Button size="sm" onClick={() => setSwapOpen(swapOpen === i ? null : i)}>Swap</Button>
                    <Menu open={swapOpen === i} onClose={() => setSwapOpen(null)} className="top-9 right-0 max-h-80 overflow-auto">
                      {finished.filter((x) => !shown.some((s) => s.id === x.id)).map((x) => (
                        <MenuItem key={x.id} hint={timeAgo(x.finishedAt)} onClick={() => {
                          setIds(ids.map((id, j) => (j === i ? x.id : id)))
                          setSwapOpen(null)
                          setPlaying(false)
                        }}>
                          #{x.num} {x.workflowName}
                        </MenuItem>
                      ))}
                      {finished.length <= shown.length && <div className="px-3.5 py-2 text-13 text-muted">No other finished attempts.</div>}
                    </Menu>
                  </div>
                </div>
                <div className="media flex aspect-[4/5] items-center justify-center overflow-hidden rounded">
                  {out?.kind === 'video' ? (
                    <video
                      ref={(el) => {
                        vids.current[i] = el
                      }}
                      src={media(projectPath, out.path)}
                      poster={a.thumb ? media(projectPath, a.thumb) : undefined}
                      className="max-h-full max-w-full"
                      controls={!together}
                      playsInline
                      onLoadedMetadata={(e) => {
                        const len = e.currentTarget.duration || 0
                        setDuration((d) => Math.max(d, len))
                      }}
                      onTimeUpdate={(e) => i === 0 && setTime(e.currentTarget.currentTime)}
                      onEnded={() => !loop && i === 0 && setPlaying(false)}
                    />
                  ) : out ? (
                    <img src={media(projectPath, out.path)} className="max-h-full max-w-full object-contain" alt="" />
                  ) : (
                    <span className="text-text2">No file</span>
                  )}
                </div>
                <div className="mt-2.5 text-13 text-text2">
                  {attemptSummary(a)} · {timeAgo(a.finishedAt)}
                </div>
                <div className="mt-2.5 flex gap-2">
                  {isKeeper ? (
                    <Button size="sm" variant="subtle" disabled>Current keeper</Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => void setKeeper(a)}>Set as keeper</Button>
                  )}
                  <Button size="sm" onClick={() => {
                    setPendingLoad({ shotId, workflowId: a.workflowId, values: a.values, seed: a.seed })
                    go({ name: 'shot', shotId })
                  }}>Load settings</Button>
                </div>
              </Card>
            )
          })}
        </div>

        <Card className="mt-5 flex items-center gap-4 px-4 py-3">
          <button
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={toggle}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-text text-bg"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="size-5"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-5"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>
            )}
          </button>
          <span className="w-28 shrink-0 font-mono text-13">{clock(time)} / {clock(duration)}</span>
          <input
            type="range"
            aria-label="Seek"
            className="flex-1 accent-[var(--accent)]"
            min={0}
            max={duration || 1}
            step={0.01}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="text-13">Speed</span>
          <Select className="h-9 w-20" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={1}>1×</option>
            <option value={0.5}>0.5×</option>
            <option value={0.25}>0.25×</option>
          </Select>
          <span className="text-13">Sound from</span>
          <Select className="h-9 w-24" value={soundFrom ?? ''} onChange={(e) => setSoundFrom(e.target.value ? Number(e.target.value) : null)}>
            <option value="">None</option>
            {shown.map((a) => <option key={a.id} value={a.id}>#{a.num}</option>)}
          </Select>
          <Checkbox checked={loop} onChange={setLoop} label={<span className="font-normal">Loop</span>} />
        </Card>

        <Card className="mt-5 p-5">
          <div className="mb-3">
            <span className="text-17 font-semibold">What differs</span>
            <span className="ml-3 text-13 text-text2">
              {diff.rows.length} input{diff.rows.length === 1 ? '' : 's'}. Shaded cells differ from the first column (#{shown[0]?.num}).
            </span>
          </div>
          {diff.rows.length > 0 && (
            <table className="w-full table-fixed text-13">
              <thead>
                <tr className="border-b border-border text-left text-11 tracking-[0.1em] text-muted uppercase">
                  <th className="w-44 py-2">Input</th>
                  {shown.map((a) => <th key={a.id} className="py-2">#{a.num} · {a.workflowName}</th>)}
                </tr>
              </thead>
              <tbody>
                {diff.rows.map((r) => (
                  <tr key={r.key} className="border-b border-border">
                    <td className="py-2 pr-3">{r.label}</td>
                    {r.cells.map((c, j) => (
                      <td key={j} className="py-1.5 pr-3">
                        <div className={cn('rounded px-2 py-1.5 break-words', r.differsFromFirst[j] && 'bg-tint font-semibold')}>{c}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {diff.same.length > 0 && <div className="mt-3 text-13 text-text2">Same in all: {diff.same.join(', ')}.</div>}
        </Card>
      </div>
    </div>
  )
}
