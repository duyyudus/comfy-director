import { useEffect, useState, type ReactNode } from 'react'
import type { LibraryPrompt, PrompterRecord } from '@shared/types'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { Button, Checkbox, Dialog, FieldError, Input, Segmented, Select, Spinner, Textarea } from '../components/ui'

/** Prompt row in list mode: prompter row, editable list, add/paste/pick. */
export function PromptListEditor({ list, onChange, currentPrompt, error, shotName }: {
  list: string[]
  onChange: (l: string[]) => void
  currentPrompt: string
  error?: string
  shotName: string
}): ReactNode {
  const { go, toast } = useStore()
  const [prompters, setPrompters] = useState<PrompterRecord[]>([])
  const [prompterId, setPrompterId] = useState<number | null>(null)
  const [count, setCount] = useState(6)
  const [mode, setMode] = useState<'replace' | 'add'>('replace')
  const [busy, setBusy] = useState(false)
  const [ideasOpen, setIdeasOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)

  useEffect(() => {
    void api.listPrompters().then((p) => {
      setPrompters(p)
      setPrompterId((id) => id ?? p[0]?.id ?? null)
    })
  }, [])

  const prompter = prompters.find((p) => p.id === prompterId)
  const apply = (generated: string[]): void => {
    const clean = generated.map((g) => g.trim()).filter(Boolean)
    const base = list.filter((l) => l.trim())
    onChange(mode === 'replace' ? clean : [...base, ...clean])
  }

  const generate = async (ideas?: string[]): Promise<void> => {
    if (!prompter) return
    setBusy(true)
    try {
      apply(await api.generatePrompts(prompter.config, { count, currentPrompt, ideas }))
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md bg-stripe p-3">
        <div>
          <div className="mb-1 text-xs text-text2">Prompter</div>
          <Select className="h-9 min-w-44" value={prompterId ?? ''} onChange={(e) => setPrompterId(Number(e.target.value))}>
            {!prompters.length && <option value="">No prompters yet</option>}
            {prompters.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs text-text2">How many</div>
          <Input type="number" min={1} className="h-9 w-[72px]" value={count} disabled={prompter?.config.type === 'llm' && prompter.config.llm.inputMode === 'lines'}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <Button size="sm" className="h-9" disabled={!prompter || busy} onClick={() => {
          if (prompter?.config.type === 'llm' && prompter.config.llm.inputMode === 'lines') setIdeasOpen(true)
          else void generate()
        }}>
          {busy ? <Spinner /> : null} Generate
        </Button>
        <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'replace', label: 'Replace list' }, { value: 'add', label: 'Add to list' }]} />
        <Button variant="link" className="mb-2 text-13" onClick={() => go({ name: 'library', tab: 'prompters' })}>Edit prompter</Button>
      </div>

      <div className="flex flex-col gap-2">
        {list.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="w-6 pt-2.5 text-right font-mono text-xs text-muted">{i + 1}</span>
            <Textarea rows={2} className="flex-1" value={p} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} />
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
      </div>
      <FieldError>{error}</FieldError>
      <div className="mt-3 flex flex-wrap gap-2 pl-8">
        <Button size="sm" onClick={() => onChange([...list, ''])}>Add prompt</Button>
        <Button size="sm" onClick={() => setPasteOpen(true)}>Paste lines</Button>
        <Button size="sm" onClick={() => setPickOpen(true)}>Pick from Library</Button>
      </div>

      {ideasOpen && (
        <LinesDialog
          title={`Ideas for ${prompter?.name}`}
          hint="One idea per line. Each idea is sent to the prompter's endpoint, not to the ComfyUI server."
          action="Generate"
          onClose={() => setIdeasOpen(false)}
          onSubmit={(lines) => {
            setIdeasOpen(false)
            void generate(lines)
          }}
        />
      )}
      {pasteOpen && (
        <LinesDialog
          title="Paste prompts"
          hint="One prompt per line."
          action={mode === 'replace' ? 'Replace list' : 'Add to list'}
          onClose={() => setPasteOpen(false)}
          onSubmit={(lines) => {
            setPasteOpen(false)
            apply(lines)
          }}
        />
      )}
      {pickOpen && (
        <PickFromLibrary
          onClose={() => setPickOpen(false)}
          onPick={(picked) => {
            setPickOpen(false)
            onChange([...list.filter((l) => l.trim()), ...picked.map((p) => p.text)])
            void api.markPromptsUsed(picked.map((p) => p.id), shotName)
          }}
        />
      )}
    </div>
  )
}

function LinesDialog({ title, hint, action, onClose, onSubmit }: { title: string; hint: string; action: string; onClose: () => void; onSubmit: (lines: string[]) => void }): ReactNode {
  const [text, setText] = useState('')
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return (
    <Dialog open onClose={onClose} title={title} width={640}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!lines.length} onClick={() => onSubmit(lines)}>{action} ({lines.length})</Button></>}>
      <div className="mb-2 text-13 text-text2">{hint}</div>
      <Textarea autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  )
}

function PickFromLibrary({ onClose, onPick }: { onClose: () => void; onPick: (p: LibraryPrompt[]) => void }): ReactNode {
  const [prompts, setPrompts] = useState<LibraryPrompt[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<number[]>([])
  useEffect(() => {
    void api.listPrompts().then(setPrompts)
  }, [])
  const shown = prompts.filter((p) => !q || `${p.name} ${p.text} ${p.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Dialog open onClose={onClose} title="Pick from Library" width={680}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!sel.length} onClick={() => onPick(prompts.filter((p) => sel.includes(p.id)))}>Add {sel.length || ''} to list</Button></>}>
      <Input placeholder="Search prompts" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-[50vh] overflow-auto">
        {!shown.length && <div className="py-6 text-center text-text2">{prompts.length ? 'No prompts match.' : 'The Library is empty.'}</div>}
        {shown.map((p) => (
          <div key={p.id} className="flex gap-3 border-b border-border py-2.5">
            <Checkbox checked={sel.includes(p.id)} onChange={(v) => setSel((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
            <div className="min-w-0">
              <div className="font-semibold">{p.name}</div>
              <div className="line-clamp-2 text-13 text-text2">{p.text}</div>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
