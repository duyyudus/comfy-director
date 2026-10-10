import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Attempt, Sequence, Shot } from '@shared/types'
import { useStore } from '../lib/store'
import { api, errorMessage, media } from '../lib/api'
import { cn } from '../lib/cn'
import { durationOf, pad2, plural } from '../lib/format'
import { Button, Card, Chip, Empty, Grip, Menu, MenuItem } from '../components/ui'
import { PlayerDialog, SequencePlayer, Thumb } from '../components/Media'

interface Row {
  shot: Shot
  keeper: Attempt | null
  attemptCount: number
}

export function SequenceView({ sequenceId }: { sequenceId: number }): ReactNode {
  const { tree, projectVersion, go, setDialog, toast, refreshTree } = useStore()
  const projectPath = tree?.project.path ?? ''
  const [seq, setSeq] = useState<Sequence | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [playAll, setPlayAll] = useState(false)
  const [playing, setPlaying] = useState<Row | null>(null)
  const [menu, setMenu] = useState(false)
  const [selected, setSelected] = useState<number[]>([])

  const load = useCallback(async () => {
    if (!projectPath) return
    try {
      const r = await api.getSequenceShots(projectPath, sequenceId)
      setSeq(r.sequence)
      setRows(r.shots)
    } catch {
      go({ name: 'home' })
    }
  }, [projectPath, sequenceId, go])
  useEffect(() => {
    void load()
  }, [load, projectVersion])
  useEffect(() => setSelected([]), [sequenceId])

  const picked = rows.filter((r) => selected.includes(r.shot.id))
  const deleteSelected = async (): Promise<void> => {
    if (!picked.length) return
    const attempts = picked.reduce((n, r) => n + r.attemptCount, 0)
    const what = picked.length === 1
      ? `"${picked[0].shot.name}" and its ${attempts} attempt records`
      : `${picked.length} shots and their ${attempts} attempt records`
    if (!(await api.confirm(`Delete ${what}? Rendered files stay in the project folder.`, 'Delete'))) return
    try {
      for (const r of picked) await api.deleteShot(projectPath, r.shot.id)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
    setSelected([])
    await refreshTree()
    await load()
  }
  const deleteRef = useRef(deleteSelected)
  deleteRef.current = deleteSelected
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      // Del deletes the selected shots, unless the key belongs to a text field or an open dialog.
      if (e.key !== 'Delete' || e.repeat) return
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]') || document.querySelector('[role="dialog"]')) return
      void deleteRef.current()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (!seq) return <div className="p-8 text-text2">Loading…</div>

  const keepers = rows.filter((r) => r.keeper)
  const lengthOf = (r: Row): number => r.keeper?.mediaDuration ?? (r.keeper ? durationOf(r.keeper.values) : null) ?? 0
  const total = keepers.reduce((s, r) => s + lengthOf(r), 0)
  const missing = rows.filter((r) => !r.keeper).map((r) => pad2(r.shot.position))
  const avg = keepers.length ? total / keepers.length : 5

  const reorder = async (from: number, to: number): Promise<void> => {
    const ids = rows.map((r) => r.shot.id)
    const [x] = ids.splice(from, 1)
    ids.splice(to, 0, x)
    setRows((rs) => ids.map((id) => rs.find((r) => r.shot.id === id)!).map((r, i) => ({ ...r, shot: { ...r.shot, position: i + 1 } })))
    await api.reorderShots(projectPath, sequenceId, ids)
    await refreshTree()
  }

  const playItems = keepers.map((r) => {
    const out = r.keeper!.outputs.find((o) => o.kind === 'video') ?? r.keeper!.outputs[0]
    return { label: `${pad2(r.shot.position)} ${r.shot.name}`, url: out ? media(projectPath, out.path) : '' }
  }).filter((i) => i.url)

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-start gap-3 border-b border-border bg-panel px-6 pt-4 pb-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">
            Sequence · {plural(rows.length, 'shot')} · {plural(keepers.length, 'keeper')} · drag cards to reorder
          </div>
          <SeqName name={seq.name} onSave={async (n) => {
            await api.renameSequence(projectPath, seq.id, n)
            await refreshTree()
            await load()
          }} />
        </div>
        <Button onClick={() => setDialog({ kind: 'new-shot', sequenceId })}>Add shot</Button>
        <Button variant="danger" disabled={!picked.length} title="Click shot cards to select them (Del)" onClick={() => void deleteSelected()}>
          {picked.length > 1 ? `Delete ${picked.length} shots` : 'Delete shot'}
        </Button>
        <Button
          disabled={!keepers.length}
          onClick={async () => {
            try {
              const r = await api.exportKeepers(projectPath, sequenceId)
              toast(r.count ? `Exported ${plural(r.count, 'keeper')} to outputs/_keepers.` : 'No keeper files to export.')
            } catch (e) {
              toast(errorMessage(e), 'error')
            }
          }}
        >
          Export keepers
        </Button>
        <Button variant="primary" disabled={!playItems.length} onClick={() => setPlayAll(true)}>Play keepers in order</Button>
        <div className="relative">
          <Button variant="ghost" aria-label="More" onClick={() => setMenu(!menu)}>⋯</Button>
          <Menu open={menu} onClose={() => setMenu(false)} className="top-11 right-0">
            <MenuItem danger onClick={async () => {
              setMenu(false)
              if (!(await api.confirm(`Delete the sequence "${seq.name}"? Its ${rows.length} shots become loose shots.`, 'Delete'))) return
              await api.deleteSequence(projectPath, seq.id)
              await refreshTree()
              go({ name: 'home' })
            }}>Delete sequence</MenuItem>
          </Menu>
        </div>
      </div>

      <div className="p-6">
        {rows.length === 0 ? (
          <Empty title="Add the first shot" actions={<Button variant="primary" onClick={() => setDialog({ kind: 'new-shot', sequenceId })}>Add shot</Button>}>
            Shots in a sequence are shown in order, each by its keeper. Play is off until a shot has a keeper.
          </Empty>
        ) : (
          <div className="flex flex-wrap gap-5">
            {rows.map((r, i) => (
              <Card
                key={r.shot.id}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => dragFrom !== null && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom !== null && dragFrom !== i) void reorder(dragFrom, i)
                  setDragFrom(null)
                }}
                onDragEnd={() => setDragFrom(null)}
                onClick={(e) => {
                  // A click on the card selects it; its buttons keep their own clicks.
                  if ((e.target as HTMLElement).closest('button')) return
                  setSelected((s) => (s.includes(r.shot.id) ? s.filter((id) => id !== r.shot.id) : [...s, r.shot.id]))
                }}
                className={cn(
                  'flex w-[236px] cursor-pointer flex-col p-3 transition-colors',
                  selected.includes(r.shot.id) ? 'border-accent bg-tint' : 'hover:border-control',
                  dragFrom === i && 'opacity-40'
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="truncate font-semibold">{pad2(r.shot.position)} {r.shot.name}</span>
                  <span className="cursor-grab px-1" title="Drag to reorder"><Grip /></span>
                </div>
                {r.keeper ? (
                  <Thumb projectPath={projectPath} attempt={r.keeper} className="h-[280px] w-full" onPlay={() => setPlaying(r)} />
                ) : (
                  <div className="flex h-[280px] w-full flex-col items-center justify-center rounded border border-dashed border-control text-center">
                    <div className="text-text2">No keeper yet</div>
                    <div className="mt-1 text-xs text-muted">{plural(r.attemptCount, 'attempt')}</div>
                  </div>
                )}
                <div className="mt-2.5 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-13 whitespace-nowrap text-text2">
                  {r.keeper ? <Chip>{r.keeper.workflowName}</Chip> : <Chip>none yet</Chip>}
                  {r.keeper && lengthOf(r) > 0 && <span>{Math.round(lengthOf(r) * 10) / 10} s</span>}
                  {r.attemptCount > 0 && <span>{plural(r.attemptCount, 'attempt')}</span>}
                </div>
                <Button className="mt-auto" onClick={() => go({ name: 'shot', shotId: r.shot.id })}>
                  {r.attemptCount ? 'Open shot' : 'Start shot'}
                </Button>
              </Card>
            ))}
            <button
              onClick={() => setDialog({ kind: 'new-shot', sequenceId })}
              className="flex min-h-[420px] w-[120px] items-center justify-center rounded-lg border border-dashed border-control text-text2 hover:bg-stripe"
            >
              + Add shot
            </button>
          </div>
        )}

        {rows.length > 0 && (
          <Card className="mt-6 p-5">
            <div className="mb-2.5 flex justify-between text-13">
              <span>Keepers in order</span>
              <span className="text-text2">
                {Math.round(total)} s so far{missing.length ? ` · shot${missing.length > 1 ? 's' : ''} ${missing.join(', ')} missing` : ''}
              </span>
            </div>
            <div className="flex gap-1">
              {rows.map((r) => {
                const len = r.keeper ? lengthOf(r) || avg : avg
                return (
                  <div
                    key={r.shot.id}
                    style={{ flexGrow: len, flexBasis: 0 }}
                    className={cn(
                      'min-w-12 truncate rounded px-2.5 py-2 text-13',
                      r.keeper ? 'bg-tint text-text' : 'border border-dashed border-control text-text2'
                    )}
                    title={r.shot.name}
                  >
                    {pad2(r.shot.position)} · {r.keeper ? `${Math.round(lengthOf(r) * 10) / 10} s` : 'no keeper'}
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </div>

      <SequencePlayer open={playAll} onClose={() => setPlayAll(false)} items={playItems} />
      <PlayerDialog open={!!playing} onClose={() => setPlaying(null)} title={playing ? `${pad2(playing.shot.position)} ${playing.shot.name} · keeper #${playing.keeper?.num}` : ''}
        projectPath={projectPath} attempt={playing?.keeper ?? null} />
    </div>
  )
}

function SeqName({ name, onSave }: { name: string; onSave: (n: string) => Promise<void> }): ReactNode {
  const [v, setV] = useState(name)
  useEffect(() => setV(name), [name])
  return (
    <input
      aria-label="Sequence name"
      className="-ml-1 mt-0.5 w-full rounded border border-transparent bg-transparent px-1 text-22 font-semibold hover:border-border focus:border-control"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() && v.trim() !== name ? void onSave(v.trim()) : setV(name))}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
