import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { Button, Dialog, FieldError, Input, Label, Select } from './ui'

export function GlobalDialogs(): ReactNode {
  const dialog = useStore((s) => s.dialog)
  const setDialog = useStore((s) => s.setDialog)
  const close = (): void => setDialog(null)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'new-shot':
      return <NewShotDialog sequenceId={dialog.sequenceId} onClose={close} />
    case 'new-sequence':
      return <NewSequenceDialog onClose={close} />
    case 'new-project':
      return <NewProjectDialog onClose={close} />
    case 'rename-project':
      return <RenameProjectDialog onClose={close} />
  }
}

export function NewShotDialog({ sequenceId, onClose }: { sequenceId: number | null; onClose: () => void }): ReactNode {
  const { tree, workflows, settings, go, refreshTree, toast } = useStore()
  const [name, setName] = useState('Untitled shot')
  const [where, setWhere] = useState<'loose' | 'sequence'>(sequenceId !== null ? 'sequence' : 'loose')
  const [seq, setSeq] = useState<number | null>(sequenceId ?? tree?.sequences[0]?.id ?? null)
  const defaultWf = workflows.find((w) => w.id === settings?.lastWorkflowId)?.id ?? workflows[0]?.id ?? ''
  const [wf, setWf] = useState(defaultWf)
  if (!tree) return null
  const create = async (): Promise<void> => {
    try {
      const shot = await api.createShot(tree.project.path, name, where === 'sequence' ? seq : null, wf || null)
      await refreshTree()
      onClose()
      go({ name: 'shot', shotId: shot.id })
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="New shot"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={where === 'sequence' && seq === null} onClick={() => void create()}>Create shot</Button>
        </>
      }
    >
      <Label htmlFor="shot-name">Shot name</Label>
      <Input id="shot-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === 'Enter' && void create()} />
      <div className="mt-5">
        <Label>Where</Label>
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2.5">
            <input type="radio" className="size-4 accent-[var(--accent)]" checked={where === 'loose'} onChange={() => setWhere('loose')} />
            Loose shot <span className="text-[13px] text-muted">belongs to no sequence</span>
          </label>
          <label className="flex items-center gap-2.5">
            <input type="radio" className="size-4 accent-[var(--accent)]" checked={where === 'sequence'} disabled={!tree.sequences.length}
              onChange={() => setWhere('sequence')} />
            In a sequence
            <Select className="ml-2 h-9 min-w-48" disabled={where !== 'sequence'} value={seq ?? ''} onChange={(e) => setSeq(Number(e.target.value))}>
              {tree.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
          {where === 'sequence' && <div className="pl-7 text-[13px] text-muted">Added at the end. Use Move to sequence in the shot to change it later.</div>}
        </div>
      </div>
      <div className="mt-5">
        <Label htmlFor="shot-wf">Workflow</Label>
        <Select id="shot-wf" className="w-full" value={wf} onChange={(e) => setWf(e.target.value)}>
          {workflows.length === 0 && <option value="">No workflows imported yet</option>}
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>
    </Dialog>
  )
}

function NewSequenceDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { tree, go, refreshTree, toast } = useStore()
  const [name, setName] = useState('')
  if (!tree) return null
  const create = async (): Promise<void> => {
    try {
      const s = await api.createSequence(tree.project.path, name || 'Untitled sequence')
      await refreshTree()
      onClose()
      go({ name: 'sequence', sequenceId: s.id })
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="New sequence"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void create()}>Create sequence</Button>
        </>
      }
    >
      <Label htmlFor="seq-name">Sequence name</Label>
      <Input id="seq-name" autoFocus value={name} placeholder="Rooftop chase" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void create()} />
    </Dialog>
  )
}

export function ProjectNameField({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter?: () => void }): ReactNode {
  const [preview, setPreview] = useState<{ path: string; error: string | null }>({ path: '', error: null })
  useEffect(() => {
    void api.projectFolderPreview(value).then(setPreview)
  }, [value])
  return (
    <div>
      <Label htmlFor="project-name">Project name</Label>
      <Input id="project-name" autoFocus value={value} placeholder="Rooftop short" invalid={!!value && !!preview.error}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />
      {value && <FieldError>{preview.error}</FieldError>}
      <div className="mt-4">
        <Label>Folder</Label>
        <div className="rounded-md border border-border bg-fill px-3 py-2.5 font-mono text-[13px] break-all text-text2">{preview.path}</div>
        <div className="mt-1.5 text-[13px] text-muted">Everything for this project lives in this folder: its database, input images and renders.</div>
      </div>
    </div>
  )
}

function NewProjectDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { loadProjects, openProject, toast } = useStore()
  const [name, setName] = useState('')
  const create = async (): Promise<void> => {
    try {
      const p = await api.createProject(name)
      await loadProjects()
      await openProject(p.path)
      onClose()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="New project"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void create()}>Create project</Button>
        </>
      }
    >
      <ProjectNameField value={name} onChange={setName} onEnter={() => void create()} />
    </Dialog>
  )
}

function RenameProjectDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { tree, loadProjects, openProject, toast } = useStore()
  const [name, setName] = useState(tree?.project.name ?? '')
  if (!tree) return null
  const save = async (): Promise<void> => {
    try {
      const p = await api.renameProject(tree.project.path, name)
      await loadProjects()
      await openProject(p.path)
      onClose()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rename project"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || name.trim() === tree.project.name} onClick={() => void save()}>Rename</Button>
        </>
      }
    >
      <Label htmlFor="rename">New name</Label>
      <Input id="rename" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      <div className="mt-2 text-[13px] text-muted">The project folder is renamed. Files inside keep working because their paths are relative.</div>
    </Dialog>
  )
}
