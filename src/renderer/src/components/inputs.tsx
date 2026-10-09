import { useState, type DragEvent, type ReactNode } from 'react'
import type { SchemaInput } from '@core/workflow/types'
import type { InputFile, UploadFailure } from '@shared/types'
import { api, errorMessage, media } from '../lib/api'
import { cn } from '../lib/cn'
import { Button, Checkbox, FieldError, Input, Label, Select, Textarea } from './ui'
import { useStore } from '../lib/store'

export interface InputProps {
  input: SchemaInput
  value: unknown
  onChange: (v: unknown) => void
  error?: string
  projectPath: string
  files: Record<string, InputFile>
  onFiles: (f: InputFile[]) => void
  uploadFailure?: UploadFailure
  onRetryUpload?: () => void
}

/** One small component per input type. A new input kind means adding one component here. */
export function InputControl(p: InputProps): ReactNode {
  switch (p.input.type) {
    case 'text':
      return <TextControl {...p} />
    case 'number':
      return <NumberControl {...p} />
    case 'toggle':
      return <ToggleControl {...p} />
    case 'select':
      return <SelectControl {...p} />
    case 'file':
      return <FileControl {...p} />
    case 'file-group':
      return <FileGroupControl {...p} />
  }
}

function TextControl({ input, value, onChange, error }: InputProps): ReactNode {
  const v = value === undefined || value === null ? '' : String(value)
  return (
    <div className="w-full">
      <Label>{input.label}</Label>
      {input.constraints.multiline !== false ? (
        <Textarea rows={3} value={v} invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={v} invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      )}
      {input.help && <div className="mt-1 text-13 text-muted">{input.help}</div>}
      <FieldError>{error}</FieldError>
    </div>
  )
}

function NumberControl({ input, value, onChange, error }: InputProps): ReactNode {
  const c = input.constraints
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (value === undefined || value === null ? '' : String(value))
  return (
    <div className="w-[120px]">
      <Label className="truncate" >{input.label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        value={shown}
        min={c.min}
        max={c.max}
        step={c.step ?? (c.integer ? 1 : 'any')}
        invalid={!!error}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          onChange(e.target.value === '' || Number.isNaN(n) ? e.target.value : n)
        }}
        onBlur={() => setText(null)}
      />
      {input.help && <div className="mt-1 text-13 text-muted">{input.help}</div>}
      <FieldError>{error}</FieldError>
    </div>
  )
}

function ToggleControl({ input, value, onChange, error }: InputProps): ReactNode {
  return (
    <div className="w-full">
      <Checkbox checked={value === true} onChange={onChange} label={input.label} help={input.help} />
      <FieldError>{error}</FieldError>
    </div>
  )
}

function SelectControl({ input, value, onChange, error }: InputProps): ReactNode {
  const options = input.constraints.options ?? []
  const v = value === undefined || value === null ? '' : String(value)
  const missing = v && !options.includes(v)
  return (
    <div className="min-w-[200px]">
      <Label>{input.label}</Label>
      <Select className="w-full" value={v} invalid={!!error || !!missing} onChange={(e) => onChange(e.target.value)}>
        {missing && <option value={v}>{v} (not offered)</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
      {input.help && <div className="mt-1 text-13 text-muted">{input.help}</div>}
      <FieldError>{error}</FieldError>
    </div>
  )
}

function useDropFiles(projectPath: string, onAdd: (f: InputFile[]) => void): { over: boolean; handlers: Record<string, (e: DragEvent) => void> } {
  const [over, setOver] = useState(false)
  const toast = useStore((s) => s.toast)
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      },
      onDragLeave: () => setOver(false),
      onDrop: async (e: DragEvent) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setOver(false)
        try {
          const added: InputFile[] = []
          for (const f of Array.from(e.dataTransfer.files)) added.push(await api.addInputFromPath(projectPath, window.toolkit.pathForFile(f)))
          onAdd(added)
        } catch (err) {
          toast(errorMessage(err), 'error')
        }
      }
    }
  }
}

function hintFor(input: SchemaInput): string | null {
  if (input.help) return input.help
  if (input.constraints.required) return null
  if (/first_frame|last_frame/.test(input.key)) return 'Leave both frames empty for text-to-video, or fill only the first frame for image-to-video.'
  return 'Optional: leave empty and the image is left out of the workflow.'
}

function FileControl({ input, value, onChange, error, projectPath, files, onFiles, uploadFailure, onRetryUpload }: InputProps): ReactNode {
  const name = typeof value === 'string' && value ? value : null
  const pick = async (): Promise<void> => {
    const r = await api.pickImages(projectPath, false)
    if (r[0]) {
      onFiles(r)
      onChange(r[0].name)
    }
  }
  const drop = useDropFiles(projectPath, (f) => {
    onFiles(f)
    if (f[0]) onChange(f[0].name)
  })
  const failed = uploadFailure && uploadFailure.file === name
  return (
    <div className="w-[150px]">
      <Label>{input.label}{!input.constraints.required && <span className="ml-1 text-muted">optional</span>}</Label>
      <div
        {...drop.handlers}
        className={cn(
          'relative flex h-[150px] w-[150px] items-center justify-center overflow-hidden rounded-md border',
          name ? 'media border-border' : 'border-dashed border-control bg-panel',
          (error || failed) && 'border-2 border-danger',
          drop.over && 'border-accent bg-tint'
        )}
      >
        {name ? (
          <img src={media(projectPath, `inputs/${name}`)} alt={files[name]?.originalName ?? name} className="size-full object-cover" />
        ) : (
          <button className="size-full text-text2" onClick={() => void pick()}>+ Add</button>
        )}
      </div>
      {name && <div className="mt-1 truncate text-xs text-muted" title={files[name]?.originalName}>{files[name]?.originalName ?? name}</div>}
      <div className="mt-1.5 flex gap-1.5">
        {name && <Button size="sm" onClick={() => void pick()}>Replace</Button>}
        {name && !input.constraints.required && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button>}
      </div>
      {failed && (
        <div className="mt-1.5 text-13 text-danger">
          Upload failed: {uploadFailure.message}
          <div className="mt-1 flex gap-1.5">
            <Button size="sm" onClick={onRetryUpload}>Retry upload</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove image</Button>
          </div>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </div>
  )
}

export function fileHint(inputs: SchemaInput[]): string | null {
  const optional = inputs.filter((i) => i.type === 'file' && !i.constraints.required)
  if (!optional.length) return null
  return hintFor(optional[0])
}

function FileGroupControl({ input, value, onChange, error, projectPath, files, onFiles, uploadFailure, onRetryUpload }: InputProps): ReactNode {
  const list = Array.isArray(value) ? (value.filter((v) => typeof v === 'string' && v) as string[]) : []
  const max = input.constraints.maxCount
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const add = async (): Promise<void> => {
    const r = await api.pickImages(projectPath, true)
    if (!r.length) return
    onFiles(r)
    onChange([...list, ...r.map((f) => f.name)].slice(0, max ?? Infinity))
  }
  const drop = useDropFiles(projectPath, (f) => {
    onFiles(f)
    onChange([...list, ...f.map((x) => x.name)].slice(0, max ?? Infinity))
  })
  const move = (from: number, to: number): void => {
    const n = [...list]
    const [x] = n.splice(from, 1)
    n.splice(to, 0, x)
    onChange(n)
  }
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-13">{input.label}</span>
        <span className="text-13 text-text2">
          {list.length} of {max ?? '?'} slots{input.constraints.minCount ? ` · at least ${input.constraints.minCount}` : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-3" {...drop.handlers}>
        {list.map((name, i) => {
          const failed = uploadFailure?.file === name
          return (
            <div
              key={`${name}-${i}`}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => dragFrom !== null && e.preventDefault()}
              onDrop={(e) => {
                if (dragFrom === null) return
                e.preventDefault()
                e.stopPropagation()
                move(dragFrom, i)
                setDragFrom(null)
              }}
              onDragEnd={() => setDragFrom(null)}
              className={cn(
                'media group relative h-[128px] w-[96px] cursor-grab overflow-hidden rounded-md border border-border',
                failed && 'border-2 border-danger',
                dragFrom === i && 'opacity-40'
              )}
              title={files[name]?.originalName ?? name}
            >
              <img src={media(projectPath, `inputs/${name}`)} alt="" className="size-full object-cover" draggable={false} />
              <span className="absolute bottom-1 left-1.5 rounded bg-black/55 px-1 font-mono text-11 text-white">ref {i + 1}</span>
              <button
                aria-label={`Remove ref ${i + 1}`}
                onClick={() => onChange(list.filter((_, j) => j !== i))}
                className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-control bg-panel text-xs text-text"
              >
                ×
              </button>
            </div>
          )
        })}
        {(max === undefined || list.length < max) && (
          <button
            onClick={() => void add()}
            aria-label="Add images"
            className={cn('flex h-[128px] w-[96px] items-center justify-center rounded-md border border-dashed border-control text-xl text-text2 hover:bg-stripe', drop.over && 'border-accent bg-tint')}
          >
            +
          </button>
        )}
      </div>
      <div className="mt-2 text-13 text-text2">Drag to reorder. Unused slots are removed from the workflow before sending.</div>
      {uploadFailure && list.includes(uploadFailure.file) && (
        <div className="mt-1.5 flex items-center gap-2 text-13 text-danger">
          Upload of {files[uploadFailure.file]?.originalName ?? uploadFailure.file} failed: {uploadFailure.message}
          <Button size="sm" onClick={onRetryUpload}>Retry upload</Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(list.filter((n) => n !== uploadFailure.file))}>Remove image</Button>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </div>
  )
}
