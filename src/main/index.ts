import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join, resolve } from 'node:path'
import { settings, getToken } from './settings'
import { Workspace } from './workspace'
import { ServerManager } from './server'
import { JobManager } from './jobs'
import { createApi } from './api'
import { handleMedia, registerMediaScheme } from './media'
import { loadWindowState, saveWindowState } from './windowState'
import type { AppEvent } from '@shared/types'
import type { ApiMethod, ToolkitApi } from '@shared/api'

app.setName('Comfy Toolkit')
if (process.env.COMFY_TOOLKIT_USER_DATA) app.setPath('userData', process.env.COMFY_TOOLKIT_USER_DATA)

registerMediaScheme()

let mainWindow: BrowserWindow | null = null
let workspace: Workspace

function emit(e: AppEvent): void {
  mainWindow?.webContents.send('event', e)
}

function createWindow(): void {
  const min = { width: 1024, height: 680 }
  const state = loadWindowState({ width: 1440, height: 940 }, min)
  const win = (mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: min.width,
    minHeight: min.height,
    title: 'Comfy Toolkit',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1A17' : '#F5F2EC',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true
    }
  }))
  if (state.maximized) win.maximize()
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', () => saveWindowState(win))
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  const s = settings()
  nativeTheme.themeSource = s.theme === 'auto' ? 'system' : s.theme
  nativeTheme.on('updated', () => emit({ type: 'theme', dark: nativeTheme.shouldUseDarkColors }))

  workspace = new Workspace(s.workspacePath)
  const server = new ServerManager()
  const jobs = new JobManager(() => workspace, server, emit)
  server.on('status', (status) => emit({ type: 'server', status }))
  server.on('object-info', () => emit({ type: 'workflows-changed' }))

  const api = createApi({
    ws: () => workspace,
    setWorkspace: (w) => (workspace = w),
    server,
    jobs,
    emit,
    window: () => mainWindow
  })

  ipcMain.handle('api', async (_e, method: ApiMethod, ...args: unknown[]) => {
    const fn = api[method] as (...a: unknown[]) => Promise<unknown>
    if (typeof fn !== 'function') return { ok: false, error: `Unknown method ${String(method)}` }
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      console.error(`[api] ${String(method)} failed:`, e)
      return { ok: false, error: (e as Error).message ?? String(e) }
    }
  })

  handleMedia(() => [workspace.root, ...workspace.app.projects().map((p) => resolve(p.path))])

  jobs.loadActive()
  server.configure(s.serverUrl, getToken(), s.clientId)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    workspace?.close()
  } catch {
    /* ignore */
  }
})

export type { ToolkitApi }
