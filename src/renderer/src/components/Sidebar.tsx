import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { pad2 } from '../lib/format'
import { Logo, Menu, MenuItem, Segmented } from './ui'
import type { ThemeMode } from '@shared/types'

export function Sidebar(): ReactNode {
  const { tree, route, go, server, setDialog, settings, setSettings } = useStore()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const currentShot = route.name === 'shot' ? route.shotId : null
  const currentSeq = route.name === 'sequence' ? route.sequenceId : null

  // Expand the sequence that holds the current shot or is open.
  useEffect(() => {
    const seq = currentSeq ?? tree?.shots.find((s) => s.id === currentShot)?.sequenceId ?? null
    if (seq !== null) setExpanded((e) => (e.has(seq) ? e : new Set(e).add(seq)))
  }, [currentShot, currentSeq, tree])

  const statusText =
    server.state === 'connected' ? 'connected'
    : server.state === 'connecting' ? 'connecting…'
    : server.state === 'unconfigured' ? 'no server set'
    : server.state === 'unauthorized' ? 'token refused'
    : 'offline'

  const setTheme = async (m: ThemeMode): Promise<void> => {
    await api.setTheme(m)
    if (settings) setSettings({ ...settings, theme: m })
  }

  const loose = tree?.shots.filter((s) => s.sequenceId === null) ?? []

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-border bg-panel">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2 text-17 font-semibold">
          <Logo className="size-6" />
          Comfy Toolkit
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <span className={cn('size-1.5 rounded-full', server.state === 'connected' ? 'bg-accent' : server.state === 'connecting' ? 'bg-control' : 'bg-danger')} />
          <span className="truncate">{server.serverName ? `${server.serverName} · ` : ''}{statusText}</span>
        </div>
      </div>

      <div className="px-5">
        <div className="mb-1.5 text-11 tracking-[0.12em] text-muted uppercase">Project</div>
        <ProjectSwitcher />
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 scroll-thin">
        {tree && (
          <>
            <SectionHeader label="Sequences" onAdd={() => setDialog({ kind: 'new-sequence' })} addLabel="New sequence" />
            {tree.sequences.length === 0 && <div className="px-2 pb-2 text-13 text-muted">No sequences yet.</div>}
            {tree.sequences.map((seq) => {
              const shots = tree.shots.filter((s) => s.sequenceId === seq.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              const open = expanded.has(seq.id)
              return (
                <div key={seq.id}>
                  <div className={cn('group flex items-center rounded-md', currentSeq === seq.id && 'bg-tint')}>
                    <button
                      className="w-5 shrink-0 py-2 text-center text-xs text-muted"
                      aria-label={open ? 'Collapse' : 'Expand'}
                      onClick={() => {
                        const n = new Set(expanded)
                        if (open) n.delete(seq.id)
                        else n.add(seq.id)
                        setExpanded(n)
                      }}
                    >
                      {open ? '▾' : '▸'}
                    </button>
                    <button className="min-w-0 flex-1 truncate py-2 pr-2 text-left font-semibold" onClick={() => go({ name: 'sequence', sequenceId: seq.id })}>
                      {seq.name}
                    </button>
                  </div>
                  {open &&
                    shots.map((s) => (
                      <ShotRow key={s.id} active={currentShot === s.id} hasKeeper={s.hasKeeper} onClick={() => go({ name: 'shot', shotId: s.id })}>
                        {pad2(s.position)} {s.name}
                      </ShotRow>
                    ))}
                </div>
              )
            })}

            <div className="mt-4">
              <SectionHeader label="Loose shots" onAdd={() => setDialog({ kind: 'new-shot', sequenceId: null })} addLabel="New loose shot" />
              {loose.length === 0 && <div className="px-2 pb-2 text-13 text-muted">None.</div>}
              {loose.map((s) => (
                <ShotRow key={s.id} active={currentShot === s.id} hasKeeper={s.hasKeeper} onClick={() => go({ name: 'shot', shotId: s.id })}>
                  {s.name}
                </ShotRow>
              ))}
            </div>
            <div className="mt-3 flex gap-4 px-2 text-xs text-muted">
              <span className="flex items-center gap-1.5"><Dot filled /> keeper set</span>
              <span className="flex items-center gap-1.5"><Dot /> none yet</span>
            </div>
          </>
        )}
        <div className="mx-2 my-4 h-px bg-border" />
        <NavLink active={route.name === 'gallery'} onClick={() => go({ name: 'gallery' })}>Gallery</NavLink>
        <NavLink active={route.name === 'library'} onClick={() => go({ name: 'library', tab: 'prompts' })}>Library</NavLink>
        <NavLink active={route.name === 'settings'} onClick={() => go({ name: 'settings' })}>Settings</NavLink>
      </div>

      <div className="px-5 pt-3 pb-5">
        <div className="mb-1.5 text-11 tracking-[0.12em] text-muted uppercase">Theme</div>
        <Segmented
          size="sm"
          className="flex w-full [&>button]:flex-1"
          value={settings?.theme ?? 'auto'}
          onChange={(m) => void setTheme(m)}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
        />
      </div>
    </aside>
  )
}

function Dot({ filled }: { filled?: boolean }): ReactNode {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', filled ? 'bg-accent' : 'border border-control')} />
}

function ShotRow({ active, hasKeeper, onClick, children }: { active: boolean; hasKeeper: boolean; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button
      onClick={onClick}
      className={cn('flex w-full items-center gap-2.5 rounded-md py-[7px] pr-2 pl-6 text-left hover:bg-stripe', active && 'bg-tint hover:bg-tint')}
    >
      <Dot filled={hasKeeper} />
      <span className="truncate">{children}</span>
    </button>
  )
}

function SectionHeader({ label, onAdd, addLabel }: { label: string; onAdd: () => void; addLabel: string }): ReactNode {
  return (
    <div className="mb-1 flex items-center justify-between px-2">
      <span className="text-11 tracking-[0.12em] text-muted uppercase">{label}</span>
      <button
        onClick={onAdd}
        title={addLabel}
        aria-label={addLabel}
        className="flex size-7 items-center justify-center rounded-md border border-control bg-panel text-text hover:bg-stripe"
      >
        +
      </button>
    </div>
  )
}

function NavLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button onClick={onClick} className={cn('block w-full rounded-md px-2 py-2 text-left hover:bg-stripe', active && 'bg-tint font-semibold hover:bg-tint')}>
      {children}
    </button>
  )
}

function ProjectSwitcher(): ReactNode {
  const { tree, projects, openProject, setDialog, loadProjects, toast } = useStore()
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-control bg-panel px-3 font-semibold hover:bg-stripe"
      >
        <span className="truncate">{tree?.project.name ?? 'No project'}</span>
        <span className="text-xs">▾</span>
      </button>
      <Menu open={open} onClose={close} className="top-11 left-0 w-72">
        {projects.map((p) => (
          <MenuItem
            key={p.path}
            disabled={p.missing}
            hint={p.missing ? 'folder missing' : `${p.shotCount} shot${p.shotCount === 1 ? '' : 's'}`}
            onClick={() => {
              close()
              void openProject(p.path)
            }}
          >
            <span className={cn(tree?.project.path === p.path && 'font-semibold')}>{p.name}</span>
          </MenuItem>
        ))}
        {projects.length > 0 && <div className="my-1.5 h-px bg-border" />}
        <MenuItem onClick={() => (close(), setDialog({ kind: 'new-project' }))}>New project</MenuItem>
        <MenuItem disabled={!tree} onClick={() => (close(), setDialog({ kind: 'rename-project' }))}>Rename project</MenuItem>
        <MenuItem disabled={!tree} onClick={() => (close(), void api.revealProject(tree!.project.path))}>Open project folder</MenuItem>
        <MenuItem
          onClick={async () => {
            close()
            try {
              const p = await api.openExistingProject()
              if (p) {
                await loadProjects()
                await openProject(p.path)
              }
            } catch (e) {
              toast(errorMessage(e), 'error')
            }
          }}
        >
          Open existing project…
        </MenuItem>
        <MenuItem
          disabled={!tree}
          hint="keeps the folder"
          onClick={async () => {
            close()
            if (!tree) return
            if (!confirm(`Remove "${tree.project.name}" from the list? The folder and its files are not deleted.`)) return
            await api.removeProject(tree.project.path)
            await loadProjects()
            const next = useStore.getState().projects.find((p) => !p.missing)
            await openProject(next?.path ?? null)
          }}
        >
          Remove from list
        </MenuItem>
      </Menu>
    </div>
  )
}
