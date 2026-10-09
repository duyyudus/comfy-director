import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { DEFAULT_FONT_SIZE, FONT_SIZES, type AppSettings, type ThemeMode } from '@shared/types'

/**
 * App settings live in the app's data folder (`Comfy Toolkit`), never in the workspace.
 * The access token is encrypted with Electron safeStorage (OS keychain / DPAPI / libsecret).
 */
interface StoredSettings {
  serverUrl: string
  workspacePath: string
  theme: ThemeMode
  fontSize: number
  clientId: string
  currentProject: string | null
  setupDone: boolean
}

const dir = (): string => app.getPath('userData')
const file = (): string => join(dir(), 'settings.json')
const tokenFile = (): string => join(dir(), 'token.bin')

let cache: StoredSettings | null = null

export function defaultWorkspace(): string {
  return join(homedir(), 'Comfy Toolkit')
}

function load(): StoredSettings {
  if (cache) return cache
  let stored: Partial<StoredSettings> = {}
  try {
    stored = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    /* first launch */
  }
  cache = {
    serverUrl: stored.serverUrl ?? '',
    workspacePath: process.env.COMFY_TOOLKIT_WORKSPACE || stored.workspacePath || defaultWorkspace(),
    theme: stored.theme ?? 'auto',
    fontSize: (FONT_SIZES as readonly number[]).includes(stored.fontSize as number) ? (stored.fontSize as number) : DEFAULT_FONT_SIZE,
    clientId: stored.clientId ?? randomUUID(),
    currentProject: stored.currentProject ?? null,
    setupDone: stored.setupDone ?? false
  }
  if (!stored.clientId) save()
  return cache
}

function save(): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(file(), JSON.stringify(cache, null, 2))
}

export function settings(): StoredSettings {
  return load()
}

export function updateSettings(patch: Partial<StoredSettings>): StoredSettings {
  cache = { ...load(), ...patch }
  save()
  return cache
}

export function getToken(): string | null {
  try {
    if (!existsSync(tokenFile())) return null
    const buf = readFileSync(tokenFile())
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
    return buf.toString('utf8')
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  if (!token) {
    rmSync(tokenFile(), { force: true })
    return
  }
  mkdirSync(dir(), { recursive: true })
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8')
  writeFileSync(tokenFile(), data, { mode: 0o600 })
}

export function publicSettings(lastWorkflowId: string | null = null): AppSettings {
  const s = load()
  return { ...s, hasToken: !!getToken(), lastWorkflowId }
}
