import { Component, useEffect, type ReactNode } from 'react'
import { useStore } from './lib/store'
import { Sidebar } from './components/Sidebar'
import { QueueDrawer, QueueStrip } from './components/Queue'
import { ConnectionBanner, ReconcileBanner, Toasts } from './components/Banners'
import { GlobalDialogs } from './components/Dialogs'
import { Thumbnailer } from './components/Thumbnailer'
import { ShotView } from './views/ShotView'
import { SequenceView } from './views/SequenceView'
import { GalleryView } from './views/GalleryView'
import { ImportView } from './views/ImportView'
import { CompareView } from './views/CompareView'
import { LibraryView } from './views/LibraryView'
import { SettingsView } from './views/SettingsView'
import { FirstLaunch } from './views/FirstLaunch'
import { HomeView } from './views/HomeView'

export function App(): ReactNode {
  const { ready, init, settings, route } = useStore()
  useEffect(() => {
    void init()
  }, [init])
  if (!ready || !settings) return <div className="flex h-full items-center justify-center text-text2">Loading…</div>
  if (!settings.setupDone) {
    return (
      <>
        <FirstLaunch />
        <Toasts />
      </>
    )
  }
  const full = route.name === 'compare'
  return (
    <div className="flex h-full">
      {!full && <Sidebar />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <ReconcileBanner />
        <main className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <ErrorBoundary key={JSON.stringify(route)}>
            <View />
          </ErrorBoundary>
        </main>
        {!full && <QueueDrawer />}
        {!full && <QueueStrip />}
      </div>
      <GlobalDialogs />
      <Toasts />
      <Thumbnailer />
    </div>
  )
}

function View(): ReactNode {
  const route = useStore((s) => s.route)
  const tree = useStore((s) => s.tree)
  switch (route.name) {
    case 'shot':
      return tree ? <ShotView key={route.shotId} shotId={route.shotId} /> : <HomeView />
    case 'sequence':
      return tree ? <SequenceView key={route.sequenceId} sequenceId={route.sequenceId} /> : <HomeView />
    case 'gallery':
      return <GalleryView />
    case 'library':
      return <LibraryView tab={route.tab} />
    case 'settings':
      return <SettingsView />
    case 'import':
      return <ImportView key={route.editId ?? ''} back={route.back} replaceId={route.replaceId} editId={route.editId} />
    case 'compare':
      return <CompareView shotId={route.shotId} attemptIds={route.attemptIds} />
    default:
      return <HomeView />
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-8">
        <div className="rounded-lg border border-danger bg-dtint p-5">
          <div className="font-semibold text-danger">This screen hit an error.</div>
          <pre className="mt-2 font-mono text-xs whitespace-pre-wrap text-text2">{this.state.error.message}</pre>
          <button className="mt-3 underline" onClick={() => useStore.getState().go({ name: 'home' })}>Go back</button>
        </div>
      </div>
    )
  }
}
