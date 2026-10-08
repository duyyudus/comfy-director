import { useEffect, useState, type ReactNode } from 'react'
import type { TestResult } from '@shared/types'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { Button, Card, Input, Label } from '../components/ui'

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
      <Input id="server-url" className="font-mono text-[13px]" placeholder="http://192.168.1.20:8188" value={url} onChange={(e) => (setUrl(e.target.value), setTest(null))} />
      <Label htmlFor="server-token" className="mt-4">Access token <span className="text-muted">(optional, for a reverse proxy)</span></Label>
      <Input id="server-token" type="password" placeholder={settings?.hasToken ? '•••••• saved in the system keychain' : ''} value={token} onChange={(e) => setToken(e.target.value)} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={busy || !url.trim()} onClick={async () => {
          setBusy(true)
          setTest(await api.testConnection(url, tokenArg()))
          setBusy(false)
        }}>Test connection</Button>
        {test && <span className={test.ok ? 'text-[13px] text-accent-text' : 'text-[13px] text-danger'}>{test.ok ? '✓ ' : ''}{test.message}</span>}
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
        <button className="mt-3 text-[13px] text-text2 hover:underline" onClick={async () => {
          await api.saveServer(url, '')
          setSettings(await api.getSettings())
          toast('Token removed.')
        }}>Remove saved token</button>
      )}
    </div>
  )
}

export function SettingsView(): ReactNode {
  const { settings, setSettings, server, loadProjects, openProject, toast } = useStore()
  const [warning, setWarning] = useState<string | null>(null)
  useEffect(() => {
    if (settings) void api.syncedWarning(settings.workspacePath).then(setWarning)
  }, [settings])
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border bg-panel px-6 pt-4 pb-4">
        <div className="text-xs text-muted">App settings</div>
        <div className="text-[22px] font-semibold">Settings</div>
      </div>
      <div className="flex max-w-[860px] flex-col gap-6 p-6">
        <Card className="p-5">
          <div className="mb-1 text-[17px] font-semibold">Server</div>
          <div className="mb-4 text-[13px] text-text2">
            The ComfyUI server that runs your jobs. Status: {server.state === 'connected' ? `connected, ${server.nodeTypeCount ?? '?'} node types` : server.state}.
            The token is kept in the system keychain, never in the workspace.
          </div>
          <ServerForm onSaved={() => toast('Server saved. Connecting…')} />
        </Card>
        <Card className="p-5">
          <div className="mb-1 text-[17px] font-semibold">Workspace folder</div>
          <div className="mb-4 text-[13px] text-text2">
            Holds your workflows (workflows/), the prompt library (app.db) and one folder per project (projects/).
          </div>
          <div className="rounded-md border border-border bg-fill px-3 py-2.5 font-mono text-[13px] break-all text-text2">{settings?.workspacePath}</div>
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
          <div className={`mt-4 rounded-md px-3 py-2.5 text-[13px] ${warning ? 'bg-dtint text-danger' : 'bg-stripe text-text2'}`}>
            {warning ?? 'Do not put the workspace in a synced folder (Dropbox, iCloud, OneDrive): sync tools can corrupt the SQLite files. Changing the folder moves nothing; pick an existing workspace or an empty folder.'}
          </div>
        </Card>
      </div>
    </div>
  )
}
