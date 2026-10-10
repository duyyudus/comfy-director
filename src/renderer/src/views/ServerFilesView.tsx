import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { serverMediaUrlFor, serverThumbUrlFor } from '@shared/api'
import { serverFilePath, type ServerFile, type ServerFolder } from '@core/comfy/files'
import { extOf, mediaKind } from '@core/output/naming'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { bytes, plural, timeAgo } from '../lib/format'
import { cn } from '../lib/cn'
import { Button, Card, Dialog, Empty, Input, PlayIcon, Segmented, Spinner } from '../components/ui'

const FOLDERS: { value: ServerFolder; label: string; help: string }[] = [
  { value: 'input', label: 'Uploaded refs', help: 'The input folder: reference images, videos and audio uploaded for a Run. A deleted ref is uploaded again by the next Run that uses it.' },
  { value: 'output', label: 'Rendered files', help: 'The output folder: what the server rendered. The app already downloaded its own results into the project, so the server copies are spare.' },
  { value: 'temp', label: 'Temp', help: 'The temp folder: previews and other leftovers. ComfyUI empties it when it restarts.' }
]

type Sort = 'newest' | 'largest' | 'name'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'largest', label: 'Largest' },
  { value: 'name', label: 'Name' }
]
/** Rows drawn at once. More are added with Show more. */
const PAGE = 300

/** Pixels asked of the server for a row's thumbnail: enough to fill the square box sharply after cropping. */
const THUMB = 256

const DAY = 86_400_000

function dayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Monday 00:00 of the current week, local time. */
function weekStart(): number {
  const d = new Date(dayStart(Date.now()))
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

/** The group a file is listed under: the day it was last modified, or 0 for anything before this week. */
function groupOf(f: ServerFile, week: number): number {
  return f.modified < week ? 0 : dayStart(f.modified)
}

function groupLabel(day: number): string {
  if (!day) return 'Before this week'
  const ago = Math.round((dayStart(Date.now()) - day) / DAY)
  const name = ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : new Date(day).toLocaleDateString(undefined, { weekday: 'long' })
  return `${name} · ${new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

const keyOf = (f: ServerFile): string => `${f.type}/${serverFilePath(f)}`

export function ServerFilesView(): ReactNode {
  const { server, back, toast } = useStore()
  const [folder, setFolder] = useState<ServerFolder>('input')
  const [files, setFiles] = useState<ServerFile[]>([])
  const [installed, setInstalled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<ServerFile | null>(null)
  const [busy, setBusy] = useState(false)
  const req = useRef(0)
  /** The row clicked last, where a Shift+click range starts. */
  const anchor = useRef<string | null>(null)
  const connected = server.state === 'connected'

  const load = useCallback(async () => {
    const id = ++req.current
    setLoading(true)
    setError(null)
    try {
      const r = await api.listServerFiles(folder)
      if (id !== req.current) return
      setInstalled(r.installed)
      setFiles(r.files)
    } catch (e) {
      if (id !== req.current) return
      setFiles([])
      setError(errorMessage(e))
    } finally {
      if (id === req.current) setLoading(false)
    }
  }, [folder])

  // The rows of the previous folder must not stay on screen (and selectable) while the new one loads.
  useEffect(() => {
    setFiles([])
    setSelected(new Set())
    setLimit(PAGE)
    if (connected) void load()
  }, [load, connected])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? files.filter((f) => serverFilePath(f).toLowerCase().includes(q)) : [...files]
    // Grouped by day, latest first; the chosen order applies inside each group.
    const week = weekStart()
    const group = new Map(list.map((f) => [f, groupOf(f, week)]))
    const order = (a: ServerFile, b: ServerFile): number =>
      sort === 'newest' ? b.modified - a.modified : sort === 'largest' ? b.size - a.size : serverFilePath(a).localeCompare(serverFilePath(b))
    list.sort((a, b) => group.get(b)! - group.get(a)! || order(a, b))
    return list
  }, [files, search, sort])
  const week = weekStart()
  const groups = new Map<number, ServerFile[]>()
  for (const f of shown) {
    const g = groupOf(f, week)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(f)
  }

  const picked = files.filter((f) => f.type === folder && selected.has(keyOf(f)))
  const allShown = shown.length > 0 && shown.every((f) => selected.has(keyOf(f)))
  /** A click on a row. With Shift, every row from the last clicked one to this one gets this row's new state. */
  const toggle = (f: ServerFile, range: boolean): void => {
    const next = new Set(selected)
    const on = !next.has(keyOf(f))
    const to = shown.indexOf(f)
    const from = range ? shown.findIndex((x) => keyOf(x) === anchor.current) : -1
    const rows = from < 0 ? [f] : shown.slice(Math.min(from, to), Math.max(from, to) + 1)
    for (const x of rows) on ? next.add(keyOf(x)) : next.delete(keyOf(x))
    anchor.current = keyOf(f)
    setSelected(next)
  }
  /** Selects the rows, or deselects them if all of them are selected already. */
  const toggleRows = (rows: ServerFile[]): void => {
    const next = new Set(selected)
    const all = rows.every((f) => next.has(keyOf(f)))
    for (const f of rows) all ? next.delete(keyOf(f)) : next.add(keyOf(f))
    setSelected(next)
  }
  const toggleAll = (): void => toggleRows(shown)

  const remove = async (): Promise<void> => {
    const size = bytes(picked.reduce((n, f) => n + f.size, 0))
    const note = folder === 'input' ? ' Shots that use a deleted ref upload it again on their next Run.' : ''
    if (!(await api.confirm(`Delete ${plural(picked.length, 'file')} (${size}) from ${server.serverName}? They are removed from the server's disk and cannot be restored.${note}`, 'Delete'))) return
    setBusy(true)
    try {
      const r = await api.deleteServerFiles(picked.map(({ filename, subfolder, type }) => ({ filename, subfolder, type })))
      if (r.errors.length) toast(`Deleted ${r.deleted} of ${picked.length}. Not deleted: ${r.errors.slice(0, 3).join('; ')}${r.errors.length > 3 ? '…' : ''}`, 'error')
      else toast(`Deleted ${plural(r.deleted, 'file')} from the server.`)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
    setBusy(false)
    setSelected(new Set())
    await load()
  }

  // The Delete key does what the Delete from server button does, unless a text field or the preview has the keyboard.
  const canDelete = picked.length > 0 && !busy && !loading
  const onDeleteKey = useRef<() => void>(() => {})
  onDeleteKey.current = () => {
    if (canDelete && !preview) void remove()
  }
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' || e.repeat || (e.target as HTMLElement).closest?.('input:not([type=checkbox]), textarea, select')) return
      e.preventDefault()
      onDeleteKey.current()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const total = bytes(files.reduce((n, f) => n + f.size, 0))
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border bg-panel px-6 pt-4 pb-4">
        <button className="text-xs text-muted hover:underline" onClick={back}>← Back</button>
        <div className="text-22 font-semibold">Server files</div>
        <div className="text-13 text-text2">Files on {server.serverName || 'the ComfyUI server'}. Nothing here touches the files in your projects.</div>
      </div>
      <div className="flex flex-col gap-4 p-6">
        {!connected ? (
          <Empty title="The server is not connected">Server files can be listed once the app is connected.</Empty>
        ) : !installed ? (
          <NodeMissing onRetry={() => void load()} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented value={folder} options={FOLDERS} onChange={setFolder} />
              <Input className="w-64" placeholder="Filter by name" value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} />
              <Segmented size="sm" value={sort} options={SORTS} onChange={setSort} />
              <span className="flex-1" />
              {loading && <Spinner />}
              <Button size="sm" disabled={loading} onClick={() => void load()}>Refresh</Button>
            </div>
            <div className="text-13 text-text2">{FOLDERS.find((f) => f.value === folder)!.help}</div>
            {error ? (
              <Empty title="Could not list the files" actions={<Button onClick={() => void load()}>Try again</Button>}>{error}</Empty>
            ) : files.length === 0 ? (
              !loading && <Empty title="This folder is empty" />
            ) : (
              <Card>
                <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
                  <input type="checkbox" className="size-[18px] cursor-pointer accent-[var(--accent)]" aria-label="Select all" checked={allShown} onChange={toggleAll} />
                  <div className="flex-1 text-13 text-text2">
                    {picked.length
                      ? `${plural(picked.length, 'file')} selected · ${bytes(picked.reduce((n, f) => n + f.size, 0))}`
                      : `${plural(files.length, 'file')} · ${total}${shown.length !== files.length ? ` · ${shown.length} shown` : ''}`}
                  </div>
                  <Button size="sm" variant="danger" disabled={!canDelete} title="Delete key" onClick={() => void remove()}>Delete from server</Button>
                </div>
                {shown.length === 0 && <div className="px-4 py-6 text-13 text-muted">No file name matches the filter.</div>}
                {shown.slice(0, limit).map((f, i) => (
                  <Fragment key={keyOf(f)}>
                  {(i === 0 || groupOf(shown[i - 1], week) !== groupOf(f, week)) && (
                    <GroupHeader
                      label={groupLabel(groupOf(f, week))}
                      files={groups.get(groupOf(f, week)) ?? []}
                      selected={selected}
                      onToggle={toggleRows}
                    />
                  )}
                  <div
                    className={cn('flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2 select-none last:border-b-0 hover:bg-stripe', selected.has(keyOf(f)) && 'bg-tint hover:bg-tint')}
                    onClick={(e) => toggle(f, e.shiftKey)}
                  >
                    {/* The row's click handler does the selecting, so that it sees the Shift key. */}
                    <input type="checkbox" className="size-[18px] cursor-pointer accent-[var(--accent)]" aria-label={`Select ${f.filename}`} checked={selected.has(keyOf(f))} onChange={() => {}} />
                    <FileThumb file={f} onOpen={() => setPreview(f)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-13">{f.filename}</div>
                      {f.subfolder && <div className="truncate font-mono text-xs text-muted">{f.subfolder}/</div>}
                    </div>
                    <div className="w-24 shrink-0 text-right text-13 text-text2">{bytes(f.size)}</div>
                    <div className="w-28 shrink-0 text-right text-13 text-text2" title={new Date(f.modified).toLocaleString()}>{timeAgo(new Date(f.modified).toISOString())}</div>
                    <Button size="sm" variant="ghost" disabled={mediaKind(f.filename) === 'other'} onClick={(e) => (e.stopPropagation(), setPreview(f))}>Preview</Button>
                  </div>
                  </Fragment>
                ))}
                {shown.length > limit && (
                  <div className="border-t border-border px-4 py-2.5 text-center">
                    <Button size="sm" variant="link" onClick={() => setLimit(limit + PAGE)}>Show more ({shown.length - limit} left)</Button>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>
      <PreviewDialog file={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

/** Heading of a day's files, or of everything before this week. Its checkbox selects the whole group. */
function GroupHeader({ label, files, selected, onToggle }: {
  label: string
  files: ServerFile[]
  selected: Set<string>
  onToggle: (files: ServerFile[]) => void
}): ReactNode {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b border-border bg-stripe px-4 py-2">
      <input
        type="checkbox"
        className="size-[18px] cursor-pointer accent-[var(--accent)]"
        checked={files.length > 0 && files.every((f) => selected.has(keyOf(f)))}
        onChange={() => onToggle(files)}
      />
      <span className="text-13 font-semibold">{label}</span>
      <span className="text-13 text-text2">{plural(files.length, 'file')} · {bytes(files.reduce((n, f) => n + f.size, 0))}</span>
    </label>
  )
}

/**
 * The row's picture: the image, or a video's first frame, made small by the server. Audio and other files,
 * and pictures the server could not make, show the file extension instead. Clicking opens the preview.
 */
function FileThumb({ file, onOpen }: { file: ServerFile; onOpen: () => void }): ReactNode {
  const kind = mediaKind(file.filename)
  const [failed, setFailed] = useState(false)
  const picture = (kind === 'image' || kind === 'video') && !failed
  return (
    <button
      type="button"
      disabled={kind === 'other'}
      aria-label={`Preview ${file.filename}`}
      onClick={(e) => (e.stopPropagation(), onOpen())}
      className={cn('relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded', picture ? 'media' : 'stripes')}
    >
      {picture ? (
        <img
          src={serverThumbUrlFor(file, THUMB, file.modified)}
          loading="lazy"
          decoding="async"
          draggable={false}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="font-mono text-11 text-text2 uppercase">{extOf(file.filename) || 'file'}</span>
      )}
      {picture && kind === 'video' && !/\.(gif|webp)$/i.test(file.filename) && <PlayIcon className="relative size-5 text-white/90 drop-shadow" />}
    </button>
  )
}

function PreviewDialog({ file, onClose }: { file: ServerFile | null; onClose: () => void }): ReactNode {
  if (!file) return null
  const url = serverMediaUrlFor(file)
  const kind = mediaKind(file.filename)
  return (
    <Dialog open onClose={onClose} title={<span className="font-mono text-base break-all">{serverFilePath(file)}</span>} width={900}>
      {kind === 'audio' ? (
        <audio src={url} controls autoPlay className="w-full" />
      ) : kind === 'video' && !/\.(gif|webp)$/i.test(file.filename) ? (
        <video src={url} controls autoPlay loop className="media max-h-[70vh] w-full rounded" />
      ) : (
        <img src={url} className="media max-h-[70vh] w-full rounded object-contain" alt="" />
      )}
      <div className="mt-3 text-13 text-text2">{bytes(file.size)} · {new Date(file.modified).toLocaleString()}</div>
    </Dialog>
  )
}

/** Shown when the server has no companion node: what it is and how to install it. */
function NodeMissing({ onRetry }: { onRetry: () => void }): ReactNode {
  const toast = useStore((s) => s.toast)
  return (
    <Empty
      title="The server needs the Comfy Director node"
      actions={
        <>
          <Button onClick={() => void api.revealServerNode().catch((e) => toast(errorMessage(e), 'error'))}>Open the node folder</Button>
          <Button variant="primary" onClick={onRetry}>Check again</Button>
        </>
      }
    >
      ComfyUI cannot list or delete files on its own. Copy the <span className="font-mono text-13">comfy_director_files</span> folder
      into <span className="font-mono text-13">ComfyUI/custom_nodes/</span> on the server and restart ComfyUI. It adds two routes and no graph nodes,
      and only reaches the input, output and temp folders.
    </Empty>
  )
}
