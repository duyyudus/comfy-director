import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GalleryFilter, GalleryItem } from '@shared/types'
import { useStore } from '../lib/store'
import { api, errorMessage, media } from '../lib/api'
import { cn } from '../lib/cn'
import { formatValue, pad2, plural, timeAgo } from '../lib/format'
import { Button, Card, Checkbox, Empty, Input, Label, Segmented, Select, Tag } from '../components/ui'
import { PlayerDialog, Thumb } from '../components/Media'

const PAGE = 60

export function GalleryView(): ReactNode {
  const { tree, workflows, projectVersion, go, setPendingLoad, openProject, toast } = useStore()
  const [filter, setFilter] = useState<Omit<GalleryFilter, 'offset' | 'limit'>>({
    project: 'current', search: '', workflowId: null, sequence: null, keepersOnly: false, groupBy: 'shot'
  })
  const [items, setItems] = useState<GalleryItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<GalleryItem | null>(null)
  const [playing, setPlaying] = useState<GalleryItem | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const req = useRef(0)

  const fetchPage = useCallback(async (offset: number) => {
    const id = ++req.current
    setLoading(true)
    try {
      const page = await api.gallery({ ...filter, offset, limit: PAGE })
      if (id !== req.current) return
      setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
      setHasMore(page.hasMore)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      if (id === req.current) setLoading(false)
    }
  }, [filter, toast])

  useEffect(() => {
    void fetchPage(0)
  }, [fetchPage, projectVersion])

  // Load more as the user scrolls.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && hasMore && !loading) void fetchPage(items.length)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, items.length, fetchPage])

  useEffect(() => {
    if (sel && !items.some((i) => i.attempt.id === sel.attempt.id && i.projectPath === sel.projectPath)) setSel(null)
  }, [items, sel])

  const set = (patch: Partial<typeof filter>): void => setFilter((f) => ({ ...f, ...patch }))
  const filtersActive = !!(filter.search || filter.workflowId || filter.sequence !== null || filter.keepersOnly)

  // Group consecutive items by shot or by day.
  const groups: { key: string; title: ReactNode; items: GalleryItem[] }[] = []
  for (const it of items) {
    const key = filter.groupBy === 'shot' ? `${it.projectPath}#${it.attempt.shotId}` : new Date(it.attempt.finishedAt ?? it.attempt.createdAt).toDateString()
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      const title =
        filter.groupBy === 'shot' ? (
          <>
            {filter.project === 'all' && <span className="text-text2">{it.projectName} / </span>}
            {it.sequenceName ? `${it.sequenceName} / ${pad2(it.shotPosition)} ${it.shotName}` : `Loose shots / ${it.shotName}`}
            <span className="ml-2.5 text-13 font-normal text-text2">{plural(it.shotAttemptCount, 'attempt')}</span>
          </>
        ) : (
          new Date(it.attempt.finishedAt ?? it.attempt.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
        )
      g = { key, title, items: [] }
      groups.push(g)
    }
    g.items.push(it)
  }

  const wfOf = (id: string): (typeof workflows)[number] | undefined => workflows.find((w) => w.id === id)

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border bg-panel px-6 pt-4 pb-4">
        <div className="text-22 font-semibold">Gallery</div>
        <div className="text-13 text-text2">Every render, across all sequences and loose shots</div>
      </div>
      <div className="flex flex-wrap items-end gap-4 border-b border-border px-6 py-4">
        <div className="min-w-56 flex-1">
          <Label>Search prompts</Label>
          <Input placeholder="roof, coat, wind…" value={filter.search} onChange={(e) => set({ search: e.target.value })} />
        </div>
        <div>
          <Label>Workflow</Label>
          <Select className="w-36" value={filter.workflowId ?? ''} onChange={(e) => set({ workflowId: e.target.value || null })}>
            <option value="">All</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Project</Label>
          <Select className="w-44" value={filter.project} onChange={(e) => set({ project: e.target.value as 'current' | 'all', sequence: null })}>
            <option value="current">{tree?.project.name ?? 'Current project'}</option>
            <option value="all">All projects</option>
          </Select>
        </div>
        <div>
          <Label>Sequence</Label>
          <Select className="w-40" disabled={filter.project === 'all'} value={filter.sequence === null ? '' : String(filter.sequence)}
            onChange={(e) => set({ sequence: e.target.value === '' ? null : e.target.value === 'loose' ? 'loose' : Number(e.target.value) })}>
            <option value="">All</option>
            {tree?.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="loose">Loose shots</option>
          </Select>
        </div>
        <Checkbox className="mb-2.5" checked={filter.keepersOnly} onChange={(v) => set({ keepersOnly: v })} label={<span className="font-normal">Keepers only</span>} />
        <div>
          <Label>Group by</Label>
          <Segmented value={filter.groupBy} onChange={(v) => set({ groupBy: v })} options={[{ value: 'shot', label: 'Shot' }, { value: 'time', label: 'Time' }]} />
        </div>
      </div>

      <div className="flex flex-1 items-start gap-6 p-6">
        <div className="min-w-0 flex-1">
          {!items.length && !loading && (
            filtersActive ? (
              <Empty title={`No renders match${filter.search ? ` "${filter.search}"` : ' these filters'}.`}
                actions={<Button onClick={() => setFilter((f) => ({ ...f, search: '', workflowId: null, sequence: null, keepersOnly: false }))}>Clear filters</Button>} />
            ) : (
              <Empty title="Nothing rendered yet">Finished attempts from every shot appear here.</Empty>
            )
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-8">
              <div className="mb-3 text-17 font-semibold">{g.title}</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-4">
                {g.items.map((it) => {
                  const active = sel?.attempt.id === it.attempt.id && sel.projectPath === it.projectPath
                  return (
                    <button key={`${it.projectPath}-${it.attempt.id}`} className="text-left" onClick={() => setSel(it)}
                      title={it.attempt.outputs.length ? 'Double-click to play' : undefined}
                      onDoubleClick={() => (it.attempt.outputs.length ? setPlaying(it) : undefined)}>
                      <Thumb projectPath={it.projectPath} attempt={it.attempt} className={cn('aspect-[2/3] w-full border', active ? 'border-2 border-accent' : 'border-border')} />
                      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-xs">
                        <span className="font-semibold">#{it.attempt.num}</span>
                        <span className="truncate text-text2">{it.attempt.workflowName}</span>
                        {it.isKeeper && <Tag kind="keeper" className="h-4 text-10">Keeper</Tag>}
                      </div>
                      {filter.groupBy === 'time' && <div className="truncate text-xs text-muted">{it.shotName}</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div ref={sentinel} className="h-8 text-13 text-text2">{hasMore ? 'More renders below, loaded as you scroll' : ''}</div>
        </div>

        {sel && (
          <Card className="sticky top-6 w-[390px] shrink-0 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-17 font-semibold">#{sel.attempt.num} · {sel.shotName}</span>
              {sel.isKeeper && <Tag kind="keeper">Keeper</Tag>}
            </div>
            {(() => {
              const out = sel.attempt.outputs.find((o) => o.kind === 'video') ?? sel.attempt.outputs.find((o) => o.kind === 'image')
              if (!out) return <div className="stripes h-[300px] rounded" />
              return out.kind === 'video' ? (
                <video key={out.path} src={media(sel.projectPath, out.path)} poster={sel.attempt.thumb ? media(sel.projectPath, sel.attempt.thumb) : undefined}
                  controls className="media max-h-[360px] w-full rounded" />
              ) : (
                <img src={media(sel.projectPath, out.path)} className="media max-h-[360px] w-full rounded object-contain" alt="" />
              )
            })()}
            <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-13">
              <dt className="text-text2">Workflow</dt>
              <dd>{sel.attempt.workflowName} <span className="text-muted">v{sel.attempt.workflowVersion}</span></dd>
              {Object.entries(sel.attempt.values).filter(([k]) => k !== 'prompt').map(([k, v]) => {
                const input = wfOf(sel.attempt.workflowId)?.inputs.find((i) => i.key === k)
                return (
                  <FragmentRow key={k} label={input?.label ?? k} value={formatValue(input, v)} />
                )
              })}
              <dt className="text-text2">Seed</dt>
              <dd className="font-mono">{sel.attempt.seed}</dd>
              <dt className="text-text2">Rendered</dt>
              <dd>{timeAgo(sel.attempt.finishedAt)}{sel.attempt.status === 'cached' && ' (cached)'}</dd>
              {'prompt' in sel.attempt.values && (
                <>
                  <dt className="text-text2">Prompt</dt>
                  <dd className="line-clamp-4">{String(sel.attempt.values.prompt || '(empty)')}</dd>
                </>
              )}
            </dl>
            <div className="mt-4 flex gap-2 border-t border-border pt-4">
              <Button variant="primary" onClick={async () => {
                if (sel.projectPath !== tree?.project.path) await openProject(sel.projectPath)
                setPendingLoad({ shotId: sel.attempt.shotId, workflowId: sel.attempt.workflowId, values: sel.attempt.values, seed: sel.attempt.seed })
                go({ name: 'shot', shotId: sel.attempt.shotId })
              }}>Load into shot</Button>
              <Button disabled={!sel.attempt.outputs.length} onClick={() => void api.revealFile(sel.projectPath, sel.attempt.outputs[0].path)}>Reveal file</Button>
            </div>
          </Card>
        )}
      </div>
      <PlayerDialog open={!!playing} onClose={() => setPlaying(null)} title={playing ? `${playing.shotName} · #${playing.attempt.num}` : ''}
        projectPath={playing?.projectPath ?? ''} attempt={playing?.attempt ?? null} />
    </div>
  )
}

function FragmentRow({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <>
      <dt className="truncate text-text2">{label}</dt>
      <dd className="break-words">{value}</dd>
    </>
  )
}
