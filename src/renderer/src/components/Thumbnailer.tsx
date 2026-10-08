import { useEffect } from 'react'
import { api, media } from '../lib/api'
import { thumbnailListeners } from '../lib/store'
import type { ThumbnailJob } from '@shared/types'

/**
 * Makes one still frame per finished attempt using the bundled Chromium (no ffmpeg needed),
 * and records the video's duration for the keeper timeline.
 */
export function Thumbnailer(): null {
  useEffect(() => {
    const queue: ThumbnailJob[] = []
    let busy = false
    const pump = async (): Promise<void> => {
      if (busy) return
      busy = true
      while (queue.length) {
        const job = queue.shift()!
        try {
          const { base64, duration } = await capture(media(job.projectPath, job.file), job.kind)
          await api.saveThumbnail(job.projectPath, job.attemptId, base64, duration)
        } catch (e) {
          console.warn('thumbnail failed', job, e)
        }
      }
      busy = false
    }
    const add = (j: ThumbnailJob): void => {
      if (!queue.some((q) => q.attemptId === j.attemptId && q.projectPath === j.projectPath)) queue.push(j)
      void pump()
    }
    thumbnailListeners.add(add)
    void api.pendingThumbnails().then((jobs) => jobs.forEach(add))
    return () => {
      thumbnailListeners.delete(add)
    }
  }, [])
  return null
}

function capture(url: string, kind: string): Promise<{ base64: string; duration: number | null }> {
  return new Promise((resolve, reject) => {
    const draw = (el: HTMLVideoElement | HTMLImageElement, w: number, h: number, duration: number | null): void => {
      const scale = Math.min(1, 480 / Math.max(w, h))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(w * scale))
      c.height = Math.max(1, Math.round(h * scale))
      c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height)
      resolve({ base64: c.toDataURL('image/jpeg', 0.82).split(',')[1], duration })
    }
    const timer = setTimeout(() => reject(new Error('timeout')), 20_000)
    if (kind === 'image') {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => (clearTimeout(timer), draw(img, img.naturalWidth, img.naturalHeight, null))
      img.onerror = () => (clearTimeout(timer), reject(new Error('image load failed')))
      img.src = url
      return
    }
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.preload = 'auto'
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 3)
    }
    v.onseeked = () => {
      clearTimeout(timer)
      draw(v, v.videoWidth, v.videoHeight, Number.isFinite(v.duration) ? v.duration : null)
      v.removeAttribute('src')
      v.load()
    }
    v.onerror = () => (clearTimeout(timer), reject(new Error('video load failed')))
    v.src = url
  })
}
