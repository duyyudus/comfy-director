import { useEffect, useRef, useState, type ReactNode } from 'react'
import { media } from '../lib/api'
import { cn } from '../lib/cn'
import type { Attempt } from '@shared/types'
import { Dialog, PlayIcon } from './ui'

/** Thumbnail of an attempt (still frame), striped placeholder when none yet. */
export function Thumb({ projectPath, attempt, className, onPlay, children }: {
  projectPath: string
  attempt: Attempt | null
  className?: string
  onPlay?: () => void
  children?: ReactNode
}): ReactNode {
  const hasMedia = !!attempt?.outputs.length
  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden rounded', attempt?.thumb ? 'media' : 'stripes', className)}>
      {attempt?.thumb && (
        <img src={media(projectPath, attempt.thumb, attempt.id)} className="absolute inset-0 size-full object-contain" alt="" draggable={false} />
      )}
      {children}
      {hasMedia && onPlay && !children && (
        <button
          onClick={onPlay}
          aria-label="Play"
          className={cn('relative flex size-full items-center justify-center', attempt?.thumb ? 'text-white/90 drop-shadow' : 'text-text2')}
        >
          <PlayIcon />
        </button>
      )}
    </div>
  )
}

export function PlayerDialog({ open, onClose, title, projectPath, attempt }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  projectPath: string
  attempt: Attempt | null
}): ReactNode {
  const out = attempt?.outputs.find((o) => o.kind === 'video') ?? attempt?.outputs.find((o) => o.kind === 'image')
  return (
    <Dialog open={open} onClose={onClose} title={title} width={900}>
      {out ? (
        out.kind === 'video' ? (
          <video src={media(projectPath, out.path)} controls autoPlay loop className="media max-h-[70vh] w-full rounded" />
        ) : (
          <img src={media(projectPath, out.path)} className="media max-h-[70vh] w-full rounded object-contain" alt="" />
        )
      ) : (
        <div className="text-text2">No output file.</div>
      )}
    </Dialog>
  )
}

/** Plays a list of videos one after another (Play keepers in order). */
export function SequencePlayer({ open, onClose, items }: {
  open: boolean
  onClose: () => void
  items: { label: string; url: string }[]
}): ReactNode {
  const [i, setI] = useState(0)
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (open) setI(0)
  }, [open])
  useEffect(() => {
    if (open) void ref.current?.play().catch(() => {})
  }, [i, open])
  const cur = items[i]
  return (
    <Dialog open={open} onClose={onClose} title={cur ? `Keepers in order · ${cur.label} (${i + 1} of ${items.length})` : 'Keepers'} width={900}>
      {cur && (
        <video
          ref={ref}
          key={cur.url}
          src={cur.url}
          controls
          autoPlay
          className="media max-h-[70vh] w-full rounded"
          onEnded={() => (i + 1 < items.length ? setI(i + 1) : undefined)}
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((it, n) => (
          <button key={n} onClick={() => setI(n)} className={cn('rounded px-2 py-1 text-13', n === i ? 'bg-tint text-accent-text' : 'bg-stripe text-text2')}>
            {it.label}
          </button>
        ))}
      </div>
    </Dialog>
  )
}
