import { joinPath, mediaUrlFor } from '@shared/api'

export const api = window.toolkit.api

export function media(projectPath: string, rel: string, version?: string | number): string {
  return mediaUrlFor(joinPath(projectPath, rel), version)
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
