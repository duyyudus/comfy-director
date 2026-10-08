import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExposeEntry, InputOverride, Overrides } from '@core/workflow/types'
import type { FieldCandidate } from '@core/workflow/discover'
import type { ImportAnalysis, ImportPreview } from '@shared/types'
import { useStore, type Route } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { plural } from '../lib/format'
import { Button, Card, Chip, Input, Label, SectionLabel, Select, Tag } from '../components/ui'

interface CandState {
  exposed: boolean
  label: string
  key: string
}

export function ImportView({ back, replaceId: initialReplace, embedded, onDone }: {
  back: Route | null
  replaceId?: string | null
  embedded?: boolean
  onDone?: () => void
}): ReactNode {
  const { workflows, server, go, toast, loadWorkflows } = useStore()
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'replace' | 'new'>('new')
  const [replaceId, setReplaceId] = useState<string | null>(initialReplace ?? null)
  const [cands, setCands] = useState<Record<string, CandState>>({})
  const [exposes, setExposes] = useState<ExposeEntry[]>([])
  const [baseOverrides, setBaseOverrides] = useState<Overrides>({})
  const [showAll, setShowAll] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const open = async (fileName: string, text: string): Promise<void> => {
    const a = await api.analyzeWorkflow(fileName, text)
    setAnalysis(a)
    if (!a.candidates.length && a.error) return
    const target = initialReplace ?? a.existingId
    const replacing = !!target && workflows.some((w) => w.id === target)
    setMode(replacing ? 'replace' : 'new')
    setReplaceId(replacing ? target : workflows[0]?.id ?? null)
    setName(replacing ? workflows.find((w) => w.id === target)!.name : a.suggestedName)
    const existing = replacing ? await api.getWorkflowOverrides(target!) : {}
    initState(a, existing)
  }

  const initState = (a: ImportAnalysis, ov: Overrides): void => {
    setBaseOverrides(ov)
    const st: Record<string, CandState> = {}
    for (const c of a.candidates) {
      const o = ov.inputs?.[c.id]
      st[c.id] = { exposed: o?.hidden !== undefined ? !o.hidden : c.defaultExposed, label: o?.label ?? defaultLabel(c.key, c.label), key: o?.key ?? c.key }
    }
    setCands(st)
    setExposes((ov.expose ?? []).filter((e) => a.fields.some((f) => f.nodeClass === e.class && f.field === e.field)))
  }

  // Switching the replace target loads that workflow's overrides as the starting point.
  const changeTarget = async (m: 'replace' | 'new', id: string | null): Promise<void> => {
    setMode(m)
    setReplaceId(id)
    if (!analysis) return
    if (m === 'replace' && id) {
      setName(workflows.find((w) => w.id === id)?.name ?? name)
      initState(analysis, await api.getWorkflowOverrides(id))
    } else initState(analysis, {})
  }

  const overrides = useMemo((): Overrides => {
    if (!analysis) return {}
    const inputs: Record<string, InputOverride> = {}
    for (const c of analysis.candidates) {
      const s = cands[c.id]
      if (!s) continue
      const o: InputOverride = { ...(baseOverrides.inputs?.[c.id] ?? {}) }
      delete o.hidden
      delete o.label
      delete o.key
      if (s.exposed !== c.defaultExposed) o.hidden = !s.exposed
      if (s.label.trim() && s.label.trim() !== c.label) o.label = s.label.trim()
      if (s.key.trim() && s.key.trim() !== c.key) o.key = s.key.trim()
      if (Object.keys(o).length) inputs[c.id] = o
    }
    const out: Overrides = {}
    if (Object.keys(inputs).length) out.inputs = inputs
    if (exposes.length) out.expose = exposes
    return out
  }, [analysis, cands, exposes, baseOverrides])

  useEffect(() => {
    if (!analysis?.text || !analysis.candidates) return
    const t = setTimeout(() => {
      void api.previewImport(analysis.text, overrides, mode === 'replace' ? replaceId : null).then(setPreview).catch(() => setPreview(null))
    }, 150)
    return () => clearTimeout(t)
  }, [analysis, overrides, mode, replaceId])

  const browse = async (): Promise<void> => {
    const f = await api.pickWorkflowFile()
    if (f) await open(f.fileName, f.text)
  }

  const commit = async (): Promise<void> => {
    if (!analysis) return
    setBusy(true)
    try {
      const w = await api.commitImport({ text: analysis.text, name, mode, replaceId: mode === 'replace' ? replaceId : null, overrides })
      await loadWorkflows()
      toast(`Imported ${w.name} as version ${w.version}.`)
      if (onDone) onDone()
      else if (back) go(back)
      else go({ name: 'home' })
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const dupKeys = new Set(preview?.duplicateKeys ?? [])
  const visibleFields = (analysis?.fields ?? []).filter((f) => (showAll || f.suggested) && !exposes.some((e) => e.class === f.nodeClass && e.field === f.field && sameTitle(e, f)))
  const exposedFields = (analysis?.fields ?? []).filter((f) => exposes.some((e) => e.class === f.nodeClass && e.field === f.field && sameTitle(e, f)))
  const check = analysis?.check
  const canImport = !!analysis?.ok && !!name.trim() && !dupKeys.size && !busy && (mode === 'new' || !!replaceId)

  return (
    <div className="flex min-h-full flex-col">
      {!embedded && (
        <div className="flex items-start border-b border-border bg-panel px-6 pt-4 pb-4">
          <div className="flex-1">
            <div className="text-xs text-muted">Workflows</div>
            <div className="text-[22px] font-semibold">Import workflow</div>
          </div>
          {back && <Button onClick={() => go(back)}>Back</Button>}
        </div>
      )}
      <div className={cn('flex flex-1 items-start gap-6', !embedded && 'p-6')}>
        <div className="flex min-w-0 flex-[1.3] flex-col gap-6">
          <Card className="p-5">
            <Step n={1}>Choose the exported file</Step>
            <div
              onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
              onDragLeave={() => setDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files[0]
                if (f) await open(f.name, await f.text())
              }}
              className={cn('rounded-lg border border-dashed border-control px-6 py-6 text-center', dragOver && 'border-accent bg-tint')}
            >
              <div>
                Drop an API-format .json here, or{' '}
                <button className="text-accent-text underline" onClick={() => void browse()}>browse</button>
              </div>
              <div className="mt-1.5 text-[13px] text-text2">
                In ComfyUI, turn on Dev mode options, then use Save (API Format). Files saved from the normal Save button can't be run.
              </div>
            </div>
            {analysis && (
              <div className={cn('mt-4 flex flex-wrap items-center gap-3 rounded-md px-3 py-2.5', analysis.ok ? 'bg-stripe' : 'bg-dtint')}>
                <span className="font-mono text-[13px]">{analysis.fileName}</span>
                {analysis.nodeCount > 0 ? (
                  <>
                    <Chip>✓ API format</Chip>
                    <span className="text-[13px] text-text2">{analysis.nodeCount} nodes · {analysis.nodeTypeCount} node types</span>
                  </>
                ) : null}
                {analysis.error && <span className="w-full text-[13px] text-danger">{analysis.error}</span>}
              </div>
            )}
            {analysis && analysis.nodeCount > 0 && (
              <div className="mt-5 flex flex-wrap gap-6">
                <div className="min-w-60 flex-1">
                  <Label>Workflow name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label>What to do with it</Label>
                  <div className="flex flex-col gap-2">
                    <label className={cn('flex items-center gap-2.5', !workflows.length && 'opacity-50')}>
                      <input type="radio" className="size-4 accent-[var(--accent)]" disabled={!workflows.length} checked={mode === 'replace'}
                        onChange={() => void changeTarget('replace', replaceId ?? workflows[0]?.id ?? null)} />
                      Replace
                      <Select className="h-8 text-[13px]" disabled={mode !== 'replace'} value={replaceId ?? ''} onChange={(e) => void changeTarget('replace', e.target.value)}>
                        {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </Select>
                      with a new version
                    </label>
                    <label className="flex items-center gap-2.5">
                      <input type="radio" className="size-4 accent-[var(--accent)]" checked={mode === 'new'} onChange={() => void changeTarget('new', null)} />
                      Save as a separate workflow
                    </label>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {analysis && analysis.nodeCount > 0 && (
            <Card className="p-5">
              <Step n={2}>Choose which inputs to expose</Step>
              <div className="mb-3 text-[13px] text-text2">
                Control nodes are found automatically and named from their titles in the graph. Rename them here if you like; everything left unticked stays as set in the graph.
              </div>
              {dupKeys.size > 0 && (
                <div className="mb-3 rounded-md bg-dtint px-3 py-2 text-[13px] text-danger">
                  Two exposed inputs share the key {[...dupKeys].map((k) => `"${k}"`).join(', ')}. Give one of them another key, or untick one.
                </div>
              )}
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] tracking-[0.1em] text-muted uppercase">
                    <th className="w-8 py-2" />
                    <th className="py-2">Label</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Comes from</th>
                    <th className="py-2">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.candidates.map((c) => {
                    const s = cands[c.id]
                    if (!s) return null
                    const dup = s.exposed && dupKeys.has(s.key)
                    return (
                      <tr key={c.id} className="border-b border-border align-middle">
                        <td className="py-2.5">
                          <input type="checkbox" className="size-[18px] accent-[var(--accent)]" checked={s.exposed} aria-label={`Expose ${s.label}`}
                            onChange={(e) => setCands({ ...cands, [c.id]: { ...s, exposed: e.target.checked } })} />
                        </td>
                        <td className="py-2.5 pr-3">
                          <Input className="h-9" value={s.label} onChange={(e) => setCands({ ...cands, [c.id]: { ...s, label: e.target.value } })} />
                          {(dup || s.key !== c.key) && (
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-xs text-muted">key</span>
                              <Input className="h-7 font-mono text-xs" invalid={dup} value={s.key} onChange={(e) => setCands({ ...cands, [c.id]: { ...s, key: e.target.value } })} />
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3"><Chip className="font-sans">{c.type.replace('-', ' ')}</Chip></td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-text2">{c.source}</td>
                        <td className="py-2.5 font-mono text-xs">{fmtDefault(c.default, c.type, c.constraints.maxCount)}</td>
                      </tr>
                    )
                  })}
                  {exposedFields.map((f) => {
                    const e = exposes.find((x) => x.class === f.nodeClass && x.field === f.field && sameTitle(x, f))!
                    const key = e.key ?? f.key
                    return (
                      <tr key={`${f.nodeId}.${f.field}`} className="border-b border-border">
                        <td className="py-2.5">
                          <input type="checkbox" className="size-[18px] accent-[var(--accent)]" checked aria-label={`Stop exposing ${f.label}`}
                            onChange={() => setExposes(exposes.filter((x) => x !== e))} />
                        </td>
                        <td className="py-2.5 pr-3">
                          <Input className="h-9" value={e.label ?? f.label} onChange={(ev) => setExposes(exposes.map((x) => (x === e ? { ...x, label: ev.target.value } : x)))} />
                          {(dupKeys.has(key) || e.key) && (
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-xs text-muted">key</span>
                              <Input className="h-7 font-mono text-xs" invalid={dupKeys.has(key)} value={key}
                                onChange={(ev) => setExposes(exposes.map((x) => (x === e ? { ...x, key: ev.target.value } : x)))} />
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3"><Chip className="font-sans">{f.type}</Chip></td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-text2">{f.title} · {f.nodeClass}.{f.field} <span className="text-muted">(override)</span></td>
                        <td className="py-2.5 font-mono text-xs">{fmtDefault(f.value, f.type)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <SectionLabel className="mt-6 mb-2" action={
                <button className="text-xs tracking-normal text-accent-text normal-case" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show suggested only' : 'Show all fields'}</button>
              }>
                Not found automatically
              </SectionLabel>
              <div className="mb-2 text-[13px] text-text2">These are fields on regular nodes. Add the ones you want to change between runs.</div>
              {visibleFields.length === 0 && <div className="py-2 text-[13px] text-muted">No {showAll ? '' : 'suggested '}fields left.</div>}
              {visibleFields.map((f) => (
                <div key={`${f.nodeId}.${f.field}`} className="flex items-center gap-4 border-b border-border py-2.5 text-[13px]">
                  <span className="w-36 shrink-0">{f.label}</span>
                  <span className="w-20 shrink-0"><Chip className="font-sans">{f.type}</Chip></span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text2" title={f.source}>{f.source}</span>
                  <Button size="sm" onClick={() => setExposes([...exposes, { class: f.nodeClass, title: f.title, field: f.field, label: f.label }])}>Expose</Button>
                </div>
              ))}
              {analysis.seedFields.length > 0 && (
                <div className="mt-3 text-[13px] text-text2">
                  Seed: {analysis.seedFields.join(', ')}. Set by the Seed control in each shot (Random or Fixed).
                </div>
              )}
            </Card>
          )}
        </div>

        {analysis && analysis.nodeCount > 0 && (
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Card className="p-5">
              <Step n={3}>Checked against {server.serverName || 'the server'}</Step>
              {!check?.checked ? (
                <div className="text-[13px] text-text2">Not checked: the server is not connected and no node list is cached. Checks run on the next import while connected.</div>
              ) : (
                <ul className="flex flex-col gap-2 text-[13px]">
                  <CheckLine ok={!check.missingNodeTypes.length}>
                    {check.missingNodeTypes.length
                      ? `Missing node types: ${check.missingNodeTypes.join(', ')}. Install them on the server.`
                      : `All ${check.nodeTypes.length} node types are installed on the server`}
                  </CheckLine>
                  <CheckLine ok={!check.missingModels.length}>
                    {check.missingModels.length
                      ? `Model files not found: ${check.missingModels.map((m) => m.value).join(', ')}`
                      : `${plural(check.models.length, 'model file')} found${check.models.length ? `: ${[...new Set(check.models.map((m) => m.nodeTitle))].join(', ')}` : ''}`}
                  </CheckLine>
                  <CheckLine ok={!check.brokenLinks.length} blocking>
                    {check.brokenLinks.length ? `${plural(check.brokenLinks.length, 'link')} point to missing nodes. Re-export the workflow.` : 'Every link points to an existing node'}
                  </CheckLine>
                </ul>
              )}
              {check && (check.missingNodeTypes.length > 0 || check.missingModels.length > 0) && (
                <div className="mt-3 text-[13px] text-muted">Warnings do not block the import.</div>
              )}
            </Card>

            <Card className="p-5">
              <Step n={4}>What changes</Step>
              {mode === 'replace' && preview?.diff ? (
                <>
                  <div className="mb-3 font-mono text-xs text-text2">
                    {replaceId} · version {preview.previousVersion} to {preview.nextVersion} · hash {preview.hash}
                  </div>
                  <div className="flex flex-col gap-3 text-[13px]">
                    {preview.diff.added.map((i) => (
                      <DiffLine key={`a-${i.key}`} tag={<Tag kind="new">New</Tag>}><b>{i.label}</b> {i.type}. Appears in the form with its default.</DiffLine>
                    ))}
                    {preview.diff.changed.map((c) => (
                      <DiffLine key={`c-${c.after.key}`} tag={<Tag kind="changed">Changed</Tag>}><b>{c.after.label}</b> {c.what.join(', ')}. Saved shots keep their values.</DiffLine>
                    ))}
                    {preview.diff.removed.map((i) => (
                      <DiffLine key={`r-${i.key}`} tag={<Tag kind="removed">Removed</Tag>}><b>{i.label}</b> {i.type}. No longer in the workflow.</DiffLine>
                    ))}
                    {preview.diff.same.length > 0 && (
                      <DiffLine tag={<Tag kind="same">Same</Tag>}><b>{preview.diff.same.map((i) => i.label).join(', ')}</b> keep their saved values.</DiffLine>
                    )}
                    {preview.removedInUse.length > 0 && (
                      <div className="rounded-md bg-stripe px-3 py-2.5 text-text2">
                        {preview.removedInUse.map((r) => `${plural(r.shots, 'saved shot')} use${r.shots === 1 ? 's' : ''} ${r.key}`).join('; ')}. They keep the stored value, but the field is no longer shown or sent.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-[13px] text-text2">
                  New workflow · {plural(preview?.inputs.length ?? 0, 'input')} in the form: {(preview?.inputs ?? []).map((i) => i.label).join(', ') || 'none'}.
                  {' '}Inputs whose key exists in other workflows share their values with them.
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {analysis && analysis.nodeCount > 0 && (
        <div className={cn('flex items-center gap-3', embedded ? 'mt-6' : 'px-6 pb-6')}>
          <span className="flex-1 text-[13px] text-text2">Past attempts keep the exact version they ran with.</span>
          {!embedded && <Button onClick={() => (back ? go(back) : go({ name: 'home' }))}>Cancel</Button>}
          <Button variant="primary" size="lg" disabled={!canImport} onClick={() => void commit()}>
            {mode === 'replace' ? `Import as version ${preview?.nextVersion ?? ''}` : 'Import workflow'}
          </Button>
        </div>
      )}
    </div>
  )
}

function sameTitle(e: ExposeEntry, f: FieldCandidate): boolean {
  return !e.title || e.title.trim().toLowerCase() === f.title.trim().toLowerCase()
}

function defaultLabel(key: string, label: string): string {
  if (key === 'ref_images') return 'Reference images'
  if (key === 'first_frame') return 'First frame'
  if (key === 'last_frame') return 'Last frame'
  return label
}

function fmtDefault(v: unknown, type: string, max?: number): string {
  if (type === 'file-group') return max ? `up to ${max} slots` : 'slots'
  if (type === 'file') return '(empty)'
  if (v === '' || v === null || v === undefined) return '(empty)'
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  const s = String(v)
  return s.length > 28 ? `${s.slice(0, 28)}…` : s
}

function Step({ n, children }: { n: number; children: ReactNode }): ReactNode {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex size-6 items-center justify-center rounded-full bg-text text-xs font-semibold text-bg">{n}</span>
      <span className="text-[17px] font-semibold">{children}</span>
    </div>
  )
}

function CheckLine({ ok, children, blocking }: { ok: boolean; children: ReactNode; blocking?: boolean }): ReactNode {
  return (
    <li className="flex gap-2.5">
      <span className={cn('w-4 shrink-0 font-semibold', ok ? 'text-accent-text' : blocking ? 'text-danger' : 'text-danger')}>{ok ? '✓' : '!'}</span>
      <span className={cn(!ok && 'text-danger')}>{children}</span>
    </li>
  )
}

function DiffLine({ tag, children }: { tag: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="flex gap-3">
      <span className="w-[76px] shrink-0">{tag}</span>
      <span>{children}</span>
    </div>
  )
}
