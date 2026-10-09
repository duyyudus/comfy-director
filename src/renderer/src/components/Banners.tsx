import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { Banner, Button } from './ui'

export function ConnectionBanner(): ReactNode {
  const { server, go } = useStore()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (server.state !== 'offline' && server.state !== 'unauthorized') return null
  const secs = server.retryAt ? Math.max(0, Math.ceil((server.retryAt - Date.now()) / 1000)) : null
  return (
    <Banner
      kind="error"
      actions={
        <>
          <Button size="sm" onClick={() => void api.retryConnection()}>Retry now</Button>
          <Button size="sm" onClick={() => go({ name: 'settings' })}>Server settings</Button>
        </>
      }
    >
      <span className="font-semibold">
        {server.state === 'unauthorized' ? `${server.serverName} refused the access token.` : `Can't reach ${server.serverName}.`}
      </span>{' '}
      {server.state === 'unauthorized' ? 'Check it in Server settings. ' : ''}
      {secs !== null && `Retrying in ${secs} s. `}
      Your inputs and history are kept.
    </Banner>
  )
}

export function ReconcileBanner(): ReactNode {
  const { reconcile, setReconcile, tree, go } = useStore()
  if (!reconcile) return null
  const f = reconcile.finished.length
  const x = reconcile.failed.length
  const parts: string[] = []
  if (f) parts.push(`${f} attempt${f === 1 ? '' : 's'} finished`)
  if (x) parts.push(`${x} failed or stopped`)
  const items = [...reconcile.failed, ...reconcile.finished].slice(0, 4)
  return (
    <Banner actions={<Button size="sm" onClick={() => setReconcile(null)}>Dismiss</Button>}>
      <div>
        <span className="font-semibold">Back online.</span> While the app was away, {parts.join(' and ')}.
        {reconcile.stillWaiting > 0 && ` ${reconcile.stillWaiting} job${reconcile.stillWaiting === 1 ? ' is' : 's are'} still waiting.`}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-13">
        {items.map((i) => (
          <button
            key={`${i.projectPath}-${i.attemptId}`}
            className="text-accent-text hover:underline"
            onClick={() => {
              if (tree?.project.path === i.projectPath) go({ name: 'shot', shotId: i.shotId })
            }}
          >
            {i.shotName} #{i.attemptNum}: {i.status === 'failed' ? `failed (${i.note})` : i.status}
          </button>
        ))}
      </div>
    </Banner>
  )
}

export function Toasts(): ReactNode {
  const { toasts, dismissToast } = useStore()
  return (
    <div className="pointer-events-none fixed right-6 bottom-20 z-[60] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${t.kind === 'error' ? 'border-danger bg-dtint' : 'border-border bg-panel'}`}
        >
          <span className="flex-1">{t.text}</span>
          <button className="text-muted" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
