import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_FONT_SIZE, FONT_SIZES, type TestResult, type WorkflowInfo } from '@shared/types'
import { useStore, type Route } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { plural } from '../lib/format'
import { Button, Card, Input, Label, Segmented } from '../components/ui'

/** Server address + token + Test connection. Same form as the first-launch connect step. */
export function ServerForm({ onSaved, saveLabel = 'Save' }: { onSaved?: () => void; saveLabel?: string }): ReactNode {
  const { settings, setSettings, toast } = useStore()
  const [url, setUrl] = useState(settings?.serverUrl ?? '')
  const [token, setToken] = useState('')
  const [test, setTest] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const tokenArg = (): string | null => (token ? token : null)
  return (
    <div>
      <Label htmlFor="server-url">Server address</Label>
      <Input id="server-url" className="font-mono text-13" placeholder="http://192.168.1.20:8188" value={url} onChange={(e) => (setUrl(e.target.value), setTest(null))} />
      <Label htmlFor="server-token" className="mt-4">Access token <span className="text-muted">(optional, for a reverse proxy)</span></Label>
      <Input id="server-token" type="password" placeholder={settings?.hasToken ? '•••••• saved in the system keychain' : ''} value={token} onChange={(e) => setToken(e.target.value)} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={busy || !url.trim()} onClick={async () => {
          setBusy(true)
          setTest(await api.testConnection(url, tokenArg()))
          setBusy(false)
        }}>Test connection</Button>
        {test && <span className={test.ok ? 'text-13 text-accent-text' : 'text-13 text-danger'}>{test.ok ? '✓ ' : ''}{test.message}</span>}
        <span className="flex-1" />
        <Button variant="primary" disabled={!url.trim()} onClick={async () => {
          try {
            await api.saveServer(url, tokenArg())
            setSettings(await api.getSettings())
            setToken('')
            onSaved?.()
          } catch (e) {
            toast(errorMessage(e), 'error')
          }
        }}>{saveLabel}</Button>
      </div>
      {settings?.hasToken && (
        <button className="mt-3 text-13 text-text2 hover:underline" onClick={async () => {
          await api.saveServer(url, '')
          setSettings(await api.getSettings())
          toast('Token removed.')
        }}>Remove saved token</button>
      )}
    </div>
  )
}

export function SettingsView(): ReactNode {
  const { settings, setSettings, server, workflows, go, loadWorkflows, loadProjects, openProject, toast } = useStore()
  const [warning, setWarning] = useState<string | null>(null)
  useEffect(() => {
    if (settings) void api.syncedWarning(settings.workspacePath).then(setWarning)
  }, [settings])
  const back: Route = { name: 'settings' }
  const setFontSize = async (size: number): Promise<void> => {
    try {
      await api.setFontSize(size)
      if (settings) setSettings({ ...settings, fontSize: size })
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const deleteWorkflow = async (w: WorkflowInfo): Promise<void> => {
    try {
      const shots = await api.workflowShotCount(w.id)
      const used = shots ? ` ${plural(shots, 'shot')} use${shots === 1 ? 's' : ''} it and will fall back to another workflow, keeping the values.` : ''
      if (!confirm(`Delete "${w.name}"?${used} Past attempts and rendered files are kept. Its folder is moved to the system trash.`)) return
      await api.deleteWorkflow(w.id)
      await loadWorkflows()
      toast(`Deleted ${w.name}.`)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border bg-panel px-6 pt-4 pb-4">
        <div className="text-xs text-muted">App settings</div>
        <div className="text-22 font-semibold">Settings</div>
      </div>
      <div className="flex max-w-[860px] flex-col gap-6 p-6">
        <Card className="p-5">
          <div className="mb-1 text-17 font-semibold">Server</div>
          <div className="mb-4 text-13 text-text2">
            The ComfyUI server that runs your jobs. Status: {server.state === 'connected' ? `connected, ${server.nodeTypeCount ?? '?'} node types` : server.state}.
            The token is kept in the system keychain, never in the workspace.
          </div>
          <ServerForm onSaved={() => toast('Server saved. Connecting…')} />
        </Card>
        <Card className="p-5">
          <div className="mb-1 flex items-center">
            <div className="flex-1 text-17 font-semibold">Workflows</div>
            <Button size="sm" onClick={() => go({ name: 'import', back })}>Import workflow</Button>
          </div>
          <div className="mb-2 text-13 text-text2">
            Edit a workflow to rename it or change which inputs it exposes. To update its graph, import the new export and choose Replace.
          </div>
          {workflows.length === 0 && <div className="py-2 text-13 text-muted">No workflows imported yet.</div>}
          {workflows.map((w) => (
            <div key={w.id} className="flex items-center gap-3 border-t border-border py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{w.name}</div>
                <div className="truncate font-mono text-xs text-text2">{w.id} · version {w.version} · {plural(w.inputs.length, 'input')}</div>
              </div>
              <Button size="sm" onClick={() => go({ name: 'import', back, editId: w.id })}>Edit</Button>
              <Button size="sm" variant="danger" onClick={() => void deleteWorkflow(w)}>Delete</Button>
            </div>
          ))}
        </Card>
        <Card className="p-5">
          <div className="mb-1 text-17 font-semibold">Text size</div>
          <div className="mb-4 text-13 text-text2">Size of the text across the app, in pixels. Spacing and thumbnails stay the same.</div>
          <Segmented
            value={String(settings?.fontSize ?? DEFAULT_FONT_SIZE)}
            options={FONT_SIZES.map((n) => ({ value: String(n), label: n === DEFAULT_FONT_SIZE ? `${n} (default)` : String(n) }))}
            onChange={(v) => void setFontSize(Number(v))}
          />
        </Card>
        <Card className="p-5">
          <div className="mb-1 text-17 font-semibold">Workspace folder</div>
          <div className="mb-4 text-13 text-text2">
            Holds your workflows (workflows/), the prompt library (app.db) and one folder per project (projects/).
          </div>
          <div className="rounded-md border border-border bg-fill px-3 py-2.5 font-mono text-13 break-all text-text2">{settings?.workspacePath}</div>
          <div className="mt-3 flex gap-2">
            <Button onClick={async () => {
              const s = await api.chooseWorkspace()
              if (s) {
                setSettings(s)
                await loadProjects()
                const p = useStore.getState().projects.find((x) => !x.missing)
                await openProject(p?.path ?? null)
                toast('Switched workspace. Nothing was moved.')
              }
            }}>Change folder</Button>
            <Button onClick={() => void api.openWorkspaceFolder()}>Open folder</Button>
          </div>
          <div className={`mt-4 rounded-md px-3 py-2.5 text-13 ${warning ? 'bg-dtint text-danger' : 'bg-stripe text-text2'}`}>
            {warning ?? 'Do not put the workspace in a synced folder (Dropbox, iCloud, OneDrive): sync tools can corrupt the SQLite files. Changing the folder moves nothing; pick an existing workspace or an empty folder.'}
          </div>
        </Card>
      </div>
    </div>
  )
}
