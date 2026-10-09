/** Output file naming (docs/spec.md: Implementation Notes > Output rules). Pure string functions, `/` separators. */

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function safeName(name: string, max = 80): string {
  let s = name.replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/, '')
  if (s.length > max) s = s.slice(0, max).trim()
  if (!s || RESERVED.test(s)) s = `_${s}`
  return s
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Folder for a shot's outputs, relative to the project folder. */
export function shotOutputDir(shot: { name: string; position: number | null }, sequenceName: string | null): string {
  if (sequenceName === null || shot.position === null) return `outputs/_loose/${safeName(shot.name)}`
  return `outputs/${safeName(sequenceName)}/${safeName(`${pad2(shot.position)} ${shot.name}`)}`
}

/** `attemptId` is the project-wide attempt id: shots can share a folder (same name), so the per-shot number is not enough. */
export function attemptFileName(attemptId: number, workflowName: string, ext: string, index = 0): string {
  const e = ext.replace(/^\./, '').toLowerCase() || 'bin'
  const suffix = index > 0 ? `-${index + 1}` : ''
  return `attempt-${attemptId}-${safeName(workflowName, 40)}${suffix}.${e}`
}

/** `name` if it is free, otherwise `stem (2).ext`, `stem (3).ext`... so an existing file is never overwritten. */
export function freeFileName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken(candidate)) return candidate
  }
}

export function keeperExportPath(sequenceName: string, position: number, shotName: string, ext: string): string {
  return `outputs/_keepers/${safeName(sequenceName)}/${safeName(`${pad2(position)} ${shotName}`)}.${ext.replace(/^\./, '')}`
}

export function extOf(filename: string): string {
  const m = filename.match(/\.([A-Za-z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

const VIDEO = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif', 'webp'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'])
const AUDIO = new Set(['wav', 'mp3', 'flac', 'ogg', 'm4a'])

export type MediaKind = 'video' | 'image' | 'audio' | 'other'

export function mediaKind(filename: string): MediaKind {
  const e = extOf(filename)
  if (VIDEO.has(e)) return e === 'webp' || e === 'gif' ? 'image' : 'video'
  if (IMAGE.has(e)) return 'image'
  if (AUDIO.has(e)) return 'audio'
  return 'other'
}

/** Is a folder path inside a cloud-synced folder? */
export function looksSynced(path: string): string | null {
  const p = path.replace(/\\/g, '/').toLowerCase()
  const hits: [string, string][] = [
    ['/dropbox', 'Dropbox'],
    ['/onedrive', 'OneDrive'],
    ['/icloud', 'iCloud'],
    ['/mobile documents/', 'iCloud'],
    ['/library/cloudstorage/', 'a cloud storage provider'],
    ['/google drive', 'Google Drive'],
    ['/googledrive', 'Google Drive'],
    ['/box sync', 'Box']
  ]
  for (const [needle, name] of hits) if (p.includes(needle)) return name
  return null
}
