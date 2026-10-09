import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LibraryPrompt, PrompterRecord, PromptSkill } from '@shared/types'
import type { LlmConfig, PrompterConfig, PrompterType, SlotMode, TemplateConfig } from '@core/prompter/types'
import { DEFAULT_LLM, DEFAULT_SCRIPT, DEFAULT_TEMPLATE } from '@core/prompter/types'
import { templateSlots } from '@core/prompter/template'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { pad2, timeAgo } from '../lib/format'
import { Button, Card, Checkbox, Dialog, Empty, Input, Label, Segmented, Select, Spinner, Textarea } from '../components/ui'

export function LibraryView({ tab }: { tab: 'prompts' | 'prompters' }): ReactNode {
  const go = useStore((s) => s.go)
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border bg-panel px-6 pt-4 pb-4">
        <div className="text-xs text-muted">Saved prompts and prompters</div>
        <div className="text-22 font-semibold">Library</div>
      </div>
      <div className="flex gap-1 border-b border-border px-6 pt-3">
        {(['prompts', 'prompters'] as const).map((t) => (
          <button
            key={t}
            onClick={() => go({ name: 'library', tab: t })}
            className={cn('-mb-px rounded-t-md border px-4 py-2.5 capitalize', tab === t ? 'border-border border-b-bg bg-bg font-semibold' : 'border-transparent text-text2')}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'prompts' ? <PromptsTab /> : <PromptersTab />}
    </div>
  )
}

/* ================================================================ Prompts */

type Sort = 'recent' | 'most' | 'name' | 'new'

function PromptsTab(): ReactNode {
  const { tree, toast, go } = useStore()
  const [prompts, setPrompts] = useState<LibraryPrompt[]>([])
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('recent')
  const [selId, setSelId] = useState<number | null>(null)
  const [draft, setDraft] = useState<LibraryPrompt | null>(null)
  const [newTag, setNewTag] = useState('')
  const [shotId, setShotId] = useState<number | null>(null)

  const load = async (): Promise<void> => setPrompts(await api.listPrompts())
  useEffect(() => {
    void load()
  }, [])
  useEffect(() => {
    const p = prompts.find((x) => x.id === selId) ?? null
    setDraft(p ? { ...p } : null)
  }, [selId, prompts])

  const tags = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of prompts) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [prompts])

  const shown = prompts
    .filter((p) => (!tag || p.tags.includes(tag)) && (!q || `${p.name} ${p.text} ${p.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'most' ? b.usedCount - a.usedCount
      : sort === 'new' ? b.createdAt.localeCompare(a.createdAt)
      : (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt)
    )

  const shots = (tree?.shots ?? []).map((s) => {
    const seq = tree?.sequences.find((x) => x.id === s.sequenceId)
    return { id: s.id, label: seq ? `${seq.name} / ${pad2(s.position)} ${s.name}` : `Loose / ${s.name}` }
  })

  const save = async (): Promise<void> => {
    if (!draft) return
    const p = await api.savePrompt(draft)
    await load()
    setSelId(p.id)
    toast('Saved.')
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-6 py-4">
        <div className="min-w-64 flex-1">
          <Label>Search prompts</Label>
          <Input placeholder="roof, rain, closeup…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2 pb-0.5">
          <Pill active={tag === null} onClick={() => setTag(null)}>All {prompts.length}</Pill>
          {tags.slice(0, 12).map(([t, n]) => (
            <Pill key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t} {n}</Pill>
          ))}
        </div>
        <Button variant="primary" onClick={async () => {
          const p = await api.savePrompt({ name: 'New prompt', text: '', tags: [] })
          await load()
          setSelId(p.id)
        }}>New prompt</Button>
      </div>

      <div className="flex flex-1 items-start gap-6 p-6">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-17 font-semibold">Prompts <span className="font-normal text-text2">{shown.length}</span></span>
            <span className="flex items-center gap-2">
              <span className="text-13">Sort</span>
              <Select className="h-9" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="recent">Recently used</option>
                <option value="most">Most used</option>
                <option value="new">Newest</option>
                <option value="name">Name</option>
              </Select>
            </span>
          </div>
          {!shown.length && (
            <Empty title={prompts.length ? 'No prompts match.' : 'No prompts yet'}>
              {prompts.length ? 'Try another search or tag.' : 'Add one with New prompt, or use "Save to Library" under a shot\'s prompt.'}
            </Empty>
          )}
          <div className="flex flex-col gap-2.5">
            {shown.map((p) => (
              <button key={p.id} onClick={() => setSelId(p.id)}
                className={cn('rounded-lg border bg-panel p-3.5 text-left', selId === p.id ? 'border-2 border-accent bg-tint' : 'border-border hover:bg-stripe')}>
                <div><span className="font-semibold">{p.name}</span> <span className="ml-2 text-xs text-text2">Used {p.usedCount}×</span></div>
                <div className="mt-1 line-clamp-2 text-13 text-text2">{p.text || '(empty)'}</div>
                {p.tags.length > 0 && <div className="mt-1 text-xs text-muted">{p.tags.join(' · ')}</div>}
              </button>
            ))}
          </div>
        </div>

        {draft && (
          <Card className="sticky top-6 w-[450px] shrink-0 p-5">
            <Label>Name</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Label className="mt-4">Prompt</Label>
            <Textarea rows={5} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <Label className="mt-4">Tags</Label>
            <div className="flex flex-wrap items-center gap-2">
              {draft.tags.map((t) => (
                <span key={t} className="inline-flex h-9 items-center gap-2 rounded-full border border-control px-3 text-13">
                  {t}
                  <button aria-label={`Remove ${t}`} className="flex size-5 items-center justify-center rounded-full bg-fill text-xs" onClick={() => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}>×</button>
                </span>
              ))}
              <Input className="h-9 w-32" placeholder="Add a tag" value={newTag} onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTag.trim()) {
                    if (!draft.tags.includes(newTag.trim())) setDraft({ ...draft, tags: [...draft.tags, newTag.trim()] })
                    setNewTag('')
                  }
                }} />
            </div>
            <Label className="mt-4">Note</Label>
            <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />

            <div className="mt-5 rounded-lg bg-stripe p-3.5">
              <div className="flex items-center gap-3">
                <span className="text-13">Use in shot</span>
                <Select className="h-9 flex-1" value={shotId ?? ''} onChange={(e) => setShotId(Number(e.target.value) || null)}>
                  <option value="">Choose a shot…</option>
                  {shots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </div>
              <div className="mt-3 flex gap-2">
                {(['replace', 'add'] as const).map((mode) => (
                  <Button key={mode} variant={mode === 'replace' ? 'primary' : 'default'} disabled={!shotId || !tree} onClick={async () => {
                    try {
                      await api.savePrompt(draft)
                      await api.usePrompt(draft.id, tree!.project.path, shotId!, mode)
                      await load()
                      toast(mode === 'replace' ? 'Prompt replaced in the shot.' : 'Added to the shot\'s prompt list.')
                      go({ name: 'shot', shotId: shotId! })
                    } catch (e) {
                      toast(errorMessage(e), 'error')
                    }
                  }}>
                    {mode === 'replace' ? 'Replace its prompt' : 'Add to its prompt list'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-3 text-13 text-text2">
              Used {draft.usedCount} time{draft.usedCount === 1 ? '' : 's'}{draft.lastUsedIn ? ` · last in ${draft.lastUsedIn}, ${timeAgo(draft.lastUsedAt)}` : ''}
            </div>
            <div className="mt-4 flex gap-2 border-t border-border pt-4">
              <Button variant="primary" onClick={() => void save()}>Save changes</Button>
              <Button onClick={async () => {
                const p = await api.savePrompt({ name: `${draft.name} copy`, text: draft.text, tags: draft.tags, note: draft.note })
                await load()
                setSelId(p.id)
              }}>Duplicate</Button>
              <span className="flex-1" />
              <Button variant="danger" onClick={async () => {
                if (!confirm(`Delete "${draft.name}"?`)) return
                await api.deletePrompt(draft.id)
                setSelId(null)
                await load()
              }}>Delete</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button onClick={onClick} className={cn('h-9 rounded-full border px-3.5 text-13', active ? 'border-text bg-text text-bg' : 'border-control bg-panel hover:bg-stripe')}>
      {children}
    </button>
  )
}

/* ============================================================== Prompters */

const defaultConfig = (t: PrompterType): PrompterConfig =>
  t === 'template' ? { type: 'template', template: { ...DEFAULT_TEMPLATE } } : t === 'llm' ? { type: 'llm', llm: { ...DEFAULT_LLM } } : { type: 'script', script: { ...DEFAULT_SCRIPT } }

function PromptersTab(): ReactNode {
  const toast = useStore((s) => s.toast)
  const [list, setList] = useState<PrompterRecord[]>([])
  const [selId, setSelId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [configs, setConfigs] = useState<Partial<Record<PrompterType, PrompterConfig>>>({})
  const [type, setType] = useState<PrompterType>('template')
  const [preview, setPreview] = useState<string[] | null>(null)
  const [testOut, setTestOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [idea, setIdea] = useState('a woman on a rooftop at dusk')

  const load = async (): Promise<PrompterRecord[]> => {
    const l = await api.listPrompters()
    setList(l)
    return l
  }
  useEffect(() => {
    void load().then((l) => setSelId((id) => id ?? l[0]?.id ?? null))
  }, [])
  useEffect(() => {
    const p = list.find((x) => x.id === selId)
    if (!p) return
    setName(p.name)
    setType(p.type)
    setConfigs({ [p.type]: p.config })
    setPreview(null)
    setTestOut(null)
  }, [selId, list])

  const config = configs[type] ?? defaultConfig(type)
  const setConfig = (c: PrompterConfig): void => setConfigs({ ...configs, [c.type]: c })

  const save = async (): Promise<void> => {
    const p = await api.savePrompter({ id: selId ?? undefined, name: name.trim() || 'Untitled prompter', config })
    await load()
    setSelId(p.id)
    toast('Prompter saved.')
  }

  const run = async (opts: { count: number; ideas?: string[] }): Promise<string[] | null> => {
    setBusy(true)
    try {
      return await api.generatePrompts(config, { count: opts.count, currentPrompt: '', ideas: opts.ideas })
    } catch (e) {
      toast(errorMessage(e), 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 items-start gap-6 p-6">
      <div className="w-[320px] shrink-0">
        <Button variant="primary" className="mb-3 w-full" onClick={async () => {
          const p = await api.savePrompter({ name: 'New prompter', config: defaultConfig('template') })
          await load()
          setSelId(p.id)
        }}>New prompter</Button>
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <button key={p.id} onClick={() => setSelId(p.id)}
              className={cn('flex items-center justify-between rounded-lg border bg-panel px-3.5 py-3 text-left', selId === p.id ? 'border-2 border-accent bg-tint' : 'border-border hover:bg-stripe')}>
              <span className="truncate font-semibold">{p.name}</span>
              <span className="rounded-full border border-control px-2 text-xs capitalize">{p.type === 'llm' ? 'LLM' : p.type}</span>
            </button>
          ))}
          {!list.length && <div className="text-13 text-text2">No prompters yet. A prompter turns a recipe into a list of prompts for list mode.</div>}
        </div>
      </div>

      {selId !== null && (
        <Card className="min-w-0 flex-1 p-5">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Segmented value={type} onChange={(t) => (setType(t), setPreview(null), setTestOut(null))}
              options={[{ value: 'template', label: 'Template' }, { value: 'llm', label: 'LLM' }, { value: 'script', label: 'Script' }]} />
          </div>

          {config.type === 'template' && (
            <TemplateEditor cfg={config.template} onChange={(t) => setConfig({ type: 'template', template: t })} preview={preview} busy={busy}
              onPreview={async () => setPreview(await run({ count: Math.min(config.template.count, 8) }))} />
          )}
          {config.type === 'llm' && (
            <div className="mt-5">
              <SkillPicker cfg={config.llm} onChange={(llm) => setConfig({ type: 'llm', llm })} />
              <Label className="mt-4">Instruction{config.llm.skill && <span className="ml-1 text-muted">sent after the skill; can be empty</span>}</Label>
              <Textarea rows={3} value={config.llm.instruction} onChange={(e) => setConfig({ type: 'llm', llm: { ...config.llm, instruction: e.target.value } })} />
              <Label className="mt-4">Input</Label>
              <Select className="w-full" value={config.llm.inputMode} onChange={(e) => setConfig({ type: 'llm', llm: { ...config.llm, inputMode: e.target.value as 'lines' | 'shot-prompt' } })}>
                <option value="lines">One idea per line (pasted when you run it)</option>
                <option value="shot-prompt">The current shot prompt (one variation per prompt asked for)</option>
              </Select>
              <div className="mt-4 grid grid-cols-[2fr_1.2fr_1fr] gap-4">
                <div>
                  <Label>Endpoint</Label>
                  <Input className="font-mono text-13" value={config.llm.endpoint} onChange={(e) => setConfig({ type: 'llm', llm: { ...config.llm, endpoint: e.target.value } })} />
                </div>
                <div>
                  <Label>Model</Label>
                  <Input className="font-mono text-13" value={config.llm.model} onChange={(e) => setConfig({ type: 'llm', llm: { ...config.llm, model: e.target.value } })} />
                </div>
                <div>
                  <Label>Temperature</Label>
                  <Input type="number" step={0.1} min={0} max={2} value={config.llm.temperature}
                    onChange={(e) => setConfig({ type: 'llm', llm: { ...config.llm, temperature: Number(e.target.value) } })} />
                </div>
              </div>
              <Label className="mt-4">API key <span className="text-muted">optional, for hosted endpoints</span></Label>
              <Input type="password" value={config.llm.apiKey ?? ''} onChange={(e) => setConfig({ type: 'llm', llm: { ...config.llm, apiKey: e.target.value || undefined } })} />
              <div className="mt-4 rounded-md bg-tint px-3 py-2.5 text-13">
                Your ideas are sent to this endpoint (an OpenAI-compatible chat API). It is not the ComfyUI server. An LLM prompter can also be talked to per shot, in the shot's Prompt chat; attached images need a model that reads images.
              </div>
              <div className="mt-4 flex gap-2">
                <Input className="max-w-md" value={idea} placeholder="One idea to test with" onChange={(e) => setIdea(e.target.value)} />
                <Button disabled={busy || !idea.trim()} onClick={async () => {
                  const r = await run({ count: 1, ideas: [idea] })
                  if (r) setTestOut(r.join('\n\n'))
                }}>{busy && <Spinner />} Test with one idea</Button>
              </div>
              {testOut && <pre className="mt-3 rounded-md bg-[#26231f] p-3 font-mono text-xs whitespace-pre-wrap text-[#ede8df]">{testOut}</pre>}
            </div>
          )}
          {config.type === 'script' && (
            <div className="mt-5">
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <Label>Script file</Label>
                  <div className="flex gap-2">
                    <Input className="font-mono text-13" readOnly value={config.script.path} placeholder="Choose a .py or .js file" />
                    <Button onClick={async () => {
                      const p = await api.pickScriptFile()
                      if (p) setConfig({ type: 'script', script: { ...config.script, path: p } })
                    }}>Choose…</Button>
                  </div>
                </div>
                <div className="w-44">
                  <Label>Run with</Label>
                  <Select className="w-full" value={config.script.runtime} onChange={(e) => setConfig({ type: 'script', script: { ...config.script, runtime: e.target.value as 'python' | 'node' } })}>
                    <option value="python">Python</option>
                    <option value="node">Node</option>
                  </Select>
                </div>
              </div>
              <div className="mt-4 rounded-md bg-stripe px-3 py-2.5 text-13 text-text2">
                The script gets a JSON object on stdin (count, seed, prompt) and prints a JSON list of prompts on stdout. It runs with your own rights, only from the path you chose.
              </div>
              <Button className="mt-4" disabled={busy || !config.script.path} onClick={async () => {
                const r = await run({ count: 3 })
                if (r) setTestOut(JSON.stringify(r, null, 1))
              }}>{busy && <Spinner />} Test run</Button>
              {testOut && <pre className="mt-3 rounded-md bg-[#26231f] p-3 font-mono text-xs whitespace-pre-wrap text-[#ede8df]">{testOut}</pre>}
            </div>
          )}

          <div className="mt-6 flex gap-2 border-t border-border pt-4">
            <Button variant="primary" onClick={() => void save()}>Save prompter</Button>
            <Button onClick={async () => {
              const p = await api.savePrompter({ name: `${name} copy`, config })
              await load()
              setSelId(p.id)
            }}>Duplicate</Button>
            <Button variant="danger" onClick={async () => {
              if (!confirm(`Delete "${name}"?`)) return
              await api.deletePrompter(selId)
              const l = await load()
              setSelId(l[0]?.id ?? null)
            }}>Delete</Button>
          </div>
        </Card>
      )}
    </div>
  )
}

/** The prompting skill of an LLM prompter: one Markdown guide per workflow type, kept in the workspace. */
function SkillPicker({ cfg, onChange }: { cfg: LlmConfig; onChange: (c: LlmConfig) => void }): ReactNode {
  const toast = useStore((s) => s.toast)
  const [skills, setSkills] = useState<PromptSkill[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const load = async (): Promise<void> => setSkills(await api.listSkills())
  useEffect(() => {
    void load()
  }, [])
  const current = skills?.find((s) => s.type === cfg.skill)
  const add = async (type: string): Promise<void> => {
    try {
      const s = await api.addSkill(type)
      if (!s) return
      await load()
      onChange({ ...cfg, skill: s.type })
      setAddOpen(false)
      toast(`Skill saved for ${s.type}. Save the prompter to keep using it.`)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <div>
      <Label>Prompting skill <span className="text-muted">a guide for one class of workflows, sent whole before the instruction</span></Label>
      <div className="flex gap-2">
        <Select className="min-w-0 flex-1" value={cfg.skill ?? ''} onChange={(e) => onChange({ ...cfg, skill: e.target.value || undefined })}>
          <option value="">No skill</option>
          {cfg.skill && !current && <option value={cfg.skill}>{cfg.skill} (file missing)</option>}
          {(skills ?? []).map((s) => <option key={s.type} value={s.type}>{s.type}{s.name ? ` · ${s.name}` : ''}</option>)}
        </Select>
        <Button onClick={() => setAddOpen(true)}>Add skill file…</Button>
      </div>
      {current && (
        <div className="mt-1.5 text-13 text-text2">
          {current.description && <div className="line-clamp-2">{current.description}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{current.size.toLocaleString()} characters, roughly {Math.ceil(current.size / 4000)}k tokens with every request. The model's context must fit it.</span>
            <Button variant="link" className="text-13" onClick={() => void api.revealSkill(current.type)}>Show file</Button>
            <Button variant="link" className="text-13" onClick={() => void add(current.type)}>Replace file…</Button>
            <Button variant="link" className="text-13" onClick={async () => {
              if (!confirm(`Move the ${current.type} skill to the trash? Prompters that use it stop working until it is added again.`)) return
              await api.deleteSkill(current.type)
              await load()
              onChange({ ...cfg, skill: undefined })
            }}>Delete skill</Button>
          </div>
        </div>
      )}
      {cfg.skill && !current && skills && <div className="mt-1.5 text-13 text-danger">The skill file for {cfg.skill} is missing from the workspace.</div>}
      {addOpen && <AddSkillDialog skills={skills ?? []} onClose={() => setAddOpen(false)} onAdd={add} />}
    </div>
  )
}

function AddSkillDialog({ skills, onClose, onAdd }: { skills: PromptSkill[]; onClose: () => void; onAdd: (type: string) => Promise<void> }): ReactNode {
  const workflows = useStore((s) => s.workflows)
  const [type, setType] = useState('')
  const id = type.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  const exists = skills.some((s) => s.type === id)
  return (
    <Dialog open onClose={onClose} title="Add a skill file" width={560}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!id} onClick={() => void onAdd(id)}>Choose file…</Button></>}>
      <Label>Workflow type</Label>
      <Input autoFocus list="skill-types" value={type} placeholder="minimax_h3" onChange={(e) => setType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && id) void onAdd(id)
        }} />
      <datalist id="skill-types">
        {skills.map((s) => <option key={s.type} value={s.type} />)}
      </datalist>
      <div className="mt-2 text-13 text-text2">
        The class of workflows the guide is written for. One skill covers every workflow of that type
        {workflows.length > 0 && <> (yours: <span className="font-mono">{workflows.map((w) => w.id).join(', ')}</span>)</>}.
        A type that starts a workflow's id, like <span className="font-mono">minimax_h3</span> for <span className="font-mono">minimax_h3_r2v</span>, makes its prompter the default in that workflow's Prompt chat.
      </div>
      <div className="mt-3 text-13 text-text2">
        Next you choose a Markdown file from anywhere. It is copied to <span className="font-mono">prompter/skills/{id || '<type>'}/skill.md</span> in the workspace
        {exists ? <span className="text-danger">, replacing the skill already there.</span> : '.'}
      </div>
    </Dialog>
  )
}

function TemplateEditor({ cfg, onChange, preview, onPreview, busy }: {
  cfg: TemplateConfig
  onChange: (c: TemplateConfig) => void
  preview: string[] | null
  onPreview: () => void
  busy: boolean
}): ReactNode {
  const slots = templateSlots(cfg.template)
  const slot = (n: string): { mode: SlotMode; values: string[] } => cfg.slots[n] ?? { mode: 'random', values: [] }
  const setSlot = (n: string, s: { mode: SlotMode; values: string[] }): void => onChange({ ...cfg, slots: { ...cfg.slots, [n]: s } })
  return (
    <div className="mt-5">
      <Label>Template</Label>
      <Textarea rows={2} className="font-mono text-13" value={cfg.template} onChange={(e) => onChange({ ...cfg, template: e.target.value })} />
      <div className="mt-1 text-xs text-muted">Anything in {'{ }'} becomes a slot below.</div>

      <div className="mt-4 text-13 font-semibold">Slots</div>
      {!slots.length && <div className="mt-2 text-13 text-text2">No slots yet. Write a word in braces, like {'{subject}'}.</div>}
      {slots.length > 0 && (
        <table className="mt-2 w-full text-13">
          <thead>
            <tr className="border-b border-border text-left text-11 tracking-[0.1em] text-muted uppercase">
              <th className="w-32 py-2">Slot</th>
              <th className="w-48 py-2">How to pick</th>
              <th className="py-2">Values (one per line)</th>
              <th className="w-14 py-2">Count</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((n) => {
              const s = slot(n)
              const count = s.values.filter((v) => v.trim()).length
              return (
                <tr key={n} className="border-b border-border align-top">
                  <td className="py-2.5 font-mono">{`{${n}}`}</td>
                  <td className="py-2 pr-3">
                    <Select className="h-9 w-full" value={s.mode} onChange={(e) => setSlot(n, { ...s, mode: e.target.value as SlotMode })}>
                      <option value="random">Pick at random</option>
                      <option value="order">Go in order</option>
                      <option value="same">Always the same</option>
                    </Select>
                  </td>
                  <td className="py-2 pr-3">
                    <Textarea rows={Math.max(1, Math.min(5, s.values.length || 1))} className="py-1.5 text-13" value={s.values.join('\n')}
                      onChange={(e) => setSlot(n, { ...s, values: e.target.value.split('\n') })} />
                  </td>
                  <td className="py-2.5 text-text2">{count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div>
          <Label>Prompts to make</Label>
          <Input type="number" min={1} className="w-28" value={cfg.count} onChange={(e) => onChange({ ...cfg, count: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
        <div>
          <Label>Randomness seed</Label>
          <Input type="number" className="w-36" value={cfg.seed} onChange={(e) => onChange({ ...cfg, seed: Math.floor(Number(e.target.value) || 0) })} />
        </div>
        <Button onClick={() => onChange({ ...cfg, seed: Math.floor(Math.random() * 100000) })}>New seed</Button>
        <Checkbox className="mb-2.5" checked={cfg.avoidRepeats} onChange={(v) => onChange({ ...cfg, avoidRepeats: v })} label={<span className="font-normal">Avoid repeats</span>} />
      </div>
      <div className="mt-2 text-13 text-text2">Same seed gives the same list every time, so a batch can be rebuilt exactly.</div>

      <div className="mt-5 rounded-lg bg-stripe p-4">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Preview</span>
          <Button variant="primary" size="sm" disabled={busy} onClick={onPreview}>Generate preview</Button>
          {preview && <span className="text-13 text-text2">Showing {preview.length} of {cfg.count}</span>}
        </div>
        {preview && (
          <ol className="mt-3 flex flex-col gap-1.5 text-13">
            {preview.map((p, i) => (
              <li key={i} className="flex gap-2.5"><span className="w-4 text-right text-muted">{i + 1}</span>{p}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
