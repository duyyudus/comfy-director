/* Small shadcn-style component set built on the colour tokens. */
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'

type Variant = 'default' | 'primary' | 'danger' | 'ghost' | 'link' | 'subtle'
type Size = 'sm' | 'md' | 'lg'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  function Button({ variant = 'default', size = 'md', className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-colors select-none',
          'disabled:cursor-not-allowed',
          size === 'sm' && 'h-8 px-3 text-[13px]',
          size === 'md' && 'h-10 px-4',
          size === 'lg' && 'h-11 px-6 font-semibold',
          variant === 'default' && 'border border-control bg-panel text-text hover:bg-stripe disabled:border-fill disabled:bg-fill disabled:text-disabled',
          variant === 'primary' && 'bg-accent font-semibold text-white hover:brightness-110 disabled:bg-fill disabled:text-disabled',
          variant === 'danger' && 'border border-danger bg-panel text-danger hover:bg-dtint disabled:opacity-50',
          variant === 'ghost' && 'text-text2 hover:bg-stripe disabled:text-disabled',
          variant === 'subtle' && 'bg-fill text-text2 hover:brightness-95 disabled:text-disabled',
          variant === 'link' && 'h-auto px-0 text-accent-text underline-offset-2 hover:underline disabled:text-disabled',
          className
        )}
        {...props}
      />
    )
  }
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border border-control bg-panel px-3 text-text placeholder:text-muted',
        'read-only:border-border read-only:bg-fill read-only:text-text2 disabled:bg-fill disabled:text-disabled',
        invalid && 'border-danger bg-dtint',
        className
      )}
      {...props}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-md border border-control bg-panel px-3 py-2.5 leading-relaxed text-text placeholder:text-muted',
        invalid && 'border-danger bg-dtint',
        className
      )}
      {...props}
    />
  )
})

export function Select({ className, invalid, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }): ReactNode {
  return (
    <select
      className={cn('h-10 rounded-md border border-control bg-panel px-3 pr-8 text-text', invalid && 'border-danger bg-dtint', className)}
      {...props}
    >
      {children}
    </select>
  )
}

export function Checkbox({ checked, onChange, label, help, disabled, className }: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  help?: ReactNode
  disabled?: boolean
  className?: string
}): ReactNode {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2.5', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input
        type="checkbox"
        className="size-[18px] cursor-pointer accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label !== undefined && (
        <span>
          <span className="font-semibold">{label}</span>
          {help && <span className="ml-1.5 text-text2">{help}</span>}
        </span>
      )}
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', className, disabled }: {
  value: T
  options: { value: T; label: ReactNode; disabled?: boolean }[]
  onChange: (v: T) => void
  size?: 'xs' | 'sm' | 'md'
  className?: string
  disabled?: boolean
}): ReactNode {
  return (
    <div className={cn('inline-flex overflow-hidden rounded-md border border-control bg-panel', className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'transition-colors disabled:cursor-not-allowed disabled:text-disabled',
            size === 'xs' && 'h-7 px-2.5 text-xs',
            size === 'sm' && 'h-8 px-3 text-[13px]',
            size === 'md' && 'h-10 px-4',
            value === o.value ? 'bg-text text-bg' : 'text-text hover:bg-stripe'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div className={cn('rounded-lg border border-border bg-panel', className)} {...props}>
      {children}
    </div>
  )
}

export function Chip({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full border border-control px-2 font-mono text-xs text-text2', className)}>
      {children}
    </span>
  )
}

type TagKind = 'keeper' | 'running' | 'done' | 'cached' | 'failed' | 'cancelled' | 'new' | 'changed' | 'removed' | 'same' | 'queued' | 'neutral'

export function Tag({ kind, children, className }: { kind: TagKind; children: ReactNode; className?: string }): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold tracking-wide uppercase',
        kind === 'keeper' && 'bg-accent text-white',
        kind === 'running' && 'bg-tint text-accent-text',
        kind === 'queued' && 'border border-control text-text2',
        kind === 'done' && 'rounded-full border border-control px-2 text-text',
        kind === 'cached' && 'rounded-full border border-dashed border-control px-2 text-text',
        kind === 'failed' && 'rounded-full bg-danger px-2 text-white dark:text-[#1c1a17]',
        kind === 'cancelled' && 'rounded-full bg-fill px-2 text-text2',
        kind === 'new' && 'bg-accent text-white',
        kind === 'changed' && 'border border-text text-text',
        kind === 'removed' && 'border border-dashed border-text text-text',
        kind === 'same' && 'bg-fill text-text2',
        kind === 'neutral' && 'bg-fill text-text2',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Label({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }): ReactNode {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-[13px] text-text', className)}>
      {children}
    </label>
  )
}

export function SectionLabel({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }): ReactNode {
  return (
    <div className={cn('flex items-center gap-3 text-[11px] tracking-[0.12em] text-muted uppercase', className)}>
      <span className="shrink-0">{children}</span>
      <span className="h-px flex-1 bg-border" />
      {action}
    </div>
  )
}

export function FieldError({ children }: { children?: ReactNode }): ReactNode {
  if (!children) return null
  return <div className="mt-1.5 text-[13px] text-danger">{children}</div>
}

export function Progress({ value, className }: { value: number; className?: string }): ReactNode {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-fill', className)}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Dialog({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}): ReactNode {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-full overflow-auto rounded-xl border border-border bg-panel shadow-2xl scroll-thin"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 text-lg font-semibold">{title}</div>
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Menu({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    setTimeout(() => window.addEventListener('mousedown', h))
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('keydown', k)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={cn('absolute z-40 min-w-56 rounded-lg border border-border bg-panel py-1.5 shadow-xl', className)}>
      {children}
    </div>
  )
}

export function MenuItem({ children, onClick, danger, disabled, hint }: { children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-4 px-3.5 py-2 text-left hover:bg-stripe disabled:text-disabled',
        danger && 'text-danger'
      )}
    >
      <span>{children}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </button>
  )
}

export function Empty({ title, children, actions, className }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }): ReactNode {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-control px-6 py-12 text-center', className)}>
      <div className="text-base font-semibold">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-text2">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

export function Banner({ kind = 'info', children, actions }: { kind?: 'info' | 'error'; children: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <div
      className={cn(
        'flex items-center gap-4 border-b px-6 py-3',
        kind === 'error' ? 'border-danger/40 bg-dtint text-text' : 'border-border bg-tint text-text'
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}

export function PlayIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-7', className)} aria-hidden>
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  )
}

export function Grip(): ReactNode {
  return (
    <svg viewBox="0 0 12 18" className="h-[18px] w-3 text-text2" aria-hidden>
      {[3, 9].map((x) => [3, 9, 15].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={1.6} fill="currentColor" />))}
    </svg>
  )
}

export function Spinner({ className }: { className?: string }): ReactNode {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-fill border-t-accent', className)} />
}
