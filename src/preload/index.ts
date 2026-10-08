import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, type ToolkitApi } from '../shared/api'
import type { AppEvent } from '../shared/types'

const api = Object.fromEntries(
  API_METHODS.map((m) => [
    m,
    async (...args: unknown[]) => {
      const r = (await ipcRenderer.invoke('api', m, ...args)) as { ok: boolean; value?: unknown; error?: string }
      if (!r.ok) throw new Error(r.error ?? 'Unknown error')
      return r.value
    }
  ])
) as unknown as ToolkitApi

contextBridge.exposeInMainWorld('toolkit', {
  api,
  onEvent(cb: (e: AppEvent) => void): () => void {
    const h = (_: unknown, e: AppEvent): void => cb(e)
    ipcRenderer.on('event', h)
    return () => ipcRenderer.removeListener('event', h)
  },
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  platform: process.platform
})
