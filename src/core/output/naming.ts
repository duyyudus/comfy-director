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

/**
 * The output name template (Settings). One rendered name per attempt is used twice: as `filename_prefix` of the
 * workflow's save nodes (so the server copy carries it) and as the base of the downloaded file.
 */
export const DEFAULT_OUTPUT_TEMPLATE = '{sequence}_{shot}_attempt-{num}-{workflow}'
/** What files were named before the template existed; attempts queued then keep it. */
export const LEGACY_OUTPUT_TEMPLATE = 'attempt-{attempt}-{workflow}'

export const OUTPUT_TOKENS = [
  { token: 'attempt', help: 'attempt id counted over the whole project, so it never repeats (shots do not restart it)' },
  { token: 'num', help: 'attempt number within the shot, as shown in the UI (#N); each shot counts from 1' },
  { token: 'shot', help: 'shot name' },
  { token: 'sequence', help: 'sequence name (empty for a loose shot)' },
  { token: 'position', help: 'shot position in its sequence, 2 digits (empty for a loose shot)' },
  { token: 'workflow', help: 'workflow name' },
  { token: 'seed', help: 'seed of the attempt' },
  { token: 'date', help: 'YYYY-MM-DD, when the job was queued' },
  { token: 'time', help: 'HHMMSS, when the job was queued' }
] as const

export type OutputToken = (typeof OUTPUT_TOKENS)[number]['token']
export type OutputNameContext = Record<OutputToken, string | number | null>

const TOKEN = /\{([^{}]*)\}/g

/** Null when the template is usable, otherwise what is wrong with it. */
export function checkOutputTemplate(template: string): string | null {
  if (!template.trim()) return 'Enter a template.'
  const known = new Set<string>(OUTPUT_TOKENS.map((t) => t.token))
  for (const [, name] of template.matchAll(TOKEN)) if (!known.has(name)) return `Unknown token {${name}}.`
  if (/[{}]/.test(template.replace(TOKEN, ''))) return 'A { or } is not part of a token.'
  if (!template.includes('{attempt}') && !template.includes('{num}')) {
    return 'The template needs {num} or {attempt}: without one, two attempts of a shot get the same name.'
  }
  return null
}

/** The base name (no extension) for one attempt. Falls back to the default if the template renders to nothing. */
export function renderOutputName(template: string, ctx: OutputNameContext): string {
  const fill = (t: string): string =>
    t
      .replace(TOKEN, (_, name: OutputToken) => {
        const v = String(ctx[name] ?? '')
        return v ? safeName(v, 60) : ''
      })
      .replace(/([_ ])[_ ]+/g, '$1')
      .replace(/^[\s._-]+|[\s._-]+$/g, '')
  return safeName(fill(template) || fill(DEFAULT_OUTPUT_TEMPLATE), 120)
}

/** `YYYY-MM-DD` and `HHMMSS` in local time. */
export function dateParts(d: Date): { date: string; time: string } {
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  }
}

/** Name of a downloaded file: the attempt's base name, `-2`, `-3`... for further outputs of the same job. */
export function outputFileName(base: string, ext: string, index = 0): string {
  const e = ext.replace(/^\./, '').toLowerCase() || 'bin'
  return `${base}${index > 0 ? `-${index + 1}` : ''}.${e}`
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
