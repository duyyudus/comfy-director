import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME } from '@shared/api'
import { extOf } from '@core/output/naming'
import { SERVER_FOLDERS, type ServerFileRef, type ServerFolder } from '@core/comfy/files'

const TYPES: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', gif: 'image/gif',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp',
  wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4'
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
  ])
}

/** Asks the ComfyUI server for a file (`GET /view`), or for its thumbnail when `thumb` (pixels) is set. Null when there is no server to ask. */
export type ServerFileFetch = (file: ServerFileRef, range: string | null, thumb: number | null) => Promise<Response> | null

/**
 * `ctmedia://server/?filename=&subfolder=&type=`: a file on the server, passed through with its Range support.
 * With `&thumb=<pixels>` it is the file's thumbnail instead.
 */
async function serveServerFile(url: URL, range: string | null, fetchFile: ServerFileFetch): Promise<Response> {
  const filename = url.searchParams.get('filename') ?? ''
  const type = url.searchParams.get('type') as ServerFolder
  if (!filename || !SERVER_FOLDERS.includes(type)) return new Response('bad request', { status: 400 })
  try {
    const thumb = Number(url.searchParams.get('thumb')) || null
    const res = await fetchFile({ filename, subfolder: url.searchParams.get('subfolder') ?? '', type }, thumb ? null : range, thumb)
    if (!res) return new Response('not connected', { status: 503 })
    if (thumb && !res.ok) return new Response(null, { status: 404 })
    const headers: Record<string, string> = {
      'Content-Type': (thumb ? null : TYPES[extOf(filename)]) ?? res.headers.get('content-type') ?? 'application/octet-stream',
      // A thumbnail's URL carries the file's modified time, so it can be kept.
      'Cache-Control': thumb ? 'private, max-age=86400' : 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = res.headers.get(h)
      if (v) headers[h] = v
    }
    return new Response(res.body, { status: res.status, headers })
  } catch (e) {
    return new Response((e as Error).message, { status: 502 })
  }
}

/**
 * Serves local files to the renderer (videos, thumbnails, input images), with Range support for
 * seeking. Only paths inside the allowed roots (workspace and known projects) are served.
 */
export function handleMedia(allowedRoots: () => string[], serverFile: ServerFileFetch): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const url = new URL(req.url)
    if (url.hostname === 'server') return serveServerFile(url, req.headers.get('range'), serverFile)
    const p = url.searchParams.get('p')
    if (!p) return new Response('missing path', { status: 400 })
    const file = resolve(p)
    const ok = allowedRoots().some((root) => {
      const r = resolve(root)
      return file === r || file.startsWith(r.endsWith(sep) ? r : r + sep)
    })
    if (!ok) return new Response('forbidden', { status: 403 })
    let size: number
    try {
      const st = statSync(file)
      if (!st.isFile()) return new Response('not found', { status: 404 })
      size = st.size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = TYPES[extOf(file)] ?? 'application/octet-stream'
    const range = req.headers.get('range')
    const m = range?.match(/bytes=(\d*)-(\d*)/)
    if (m && size > 0) {
      let start = m[1] ? Number(m[1]) : 0
      let end = m[2] ? Number(m[2]) : size - 1
      if (!m[1] && m[2]) {
        start = Math.max(0, size - Number(m[2]))
        end = size - 1
      }
      end = Math.min(end, size - 1)
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }
    })
  })
}
