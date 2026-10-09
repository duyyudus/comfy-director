import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Window size, position and maximized state from the last close, kept in the app's data folder. */
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

const file = (): string => join(app.getPath('userData'), 'window.json')

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** True when enough of the window is on some display to grab its title bar. */
function onScreen(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
    return w >= 100 && h >= 100
  })
}

export function loadWindowState(fallback: { width: number; height: number }, min: { width: number; height: number }): WindowState {
  let stored: Partial<WindowState> = {}
  try {
    stored = JSON.parse(readFileSync(file(), 'utf8')) ?? {}
  } catch {
    /* first launch */
  }
  const state: WindowState = {
    width: isNum(stored.width) ? Math.max(min.width, Math.round(stored.width)) : fallback.width,
    height: isNum(stored.height) ? Math.max(min.height, Math.round(stored.height)) : fallback.height,
    maximized: stored.maximized === true
  }
  // Keep the position only if that display is still there; otherwise let the OS centre the window.
  if (isNum(stored.x) && isNum(stored.y)) {
    const x = Math.round(stored.x)
    const y = Math.round(stored.y)
    if (onScreen({ x, y, width: state.width, height: state.height })) Object.assign(state, { x, y })
  }
  return state
}

export function saveWindowState(win: BrowserWindow): void {
  // Normal bounds, so un-maximizing after a restart returns to the size the user last chose.
  const { x, y, width, height } = win.getNormalBounds()
  const state: WindowState = { width, height, x, y, maximized: win.isMaximized() }
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(state, null, 2))
  } catch (e) {
    console.error('[window] could not save window state:', e)
  }
}
