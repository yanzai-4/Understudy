import { useEffect } from 'react'
import type { Shot } from '../api/types'

export function frameUrl(shot: Shot, channel: string, index: number): string {
  const ext = channel === 'frames' || channel === 'dof' ? 'jpg' : 'png'
  const n = String(index).padStart(6, '0')
  return `/files/${shot.film_id}/shots/${shot.id}/${channel}/frame_${n}.${ext}`
}

/** Warm the browser cache for ±range neighboring frames of every channel. */
export function usePreloadFrames(
  shot: Shot,
  channels: string[],
  index: number,
  frameCount: number,
  range = 5,
) {
  useEffect(() => {
    const images: HTMLImageElement[] = []
    for (let d = 1; d <= range; d++) {
      for (const i of [index + d, index - d]) {
        if (i < 0 || i >= frameCount) continue
        for (const ch of channels) {
          const img = new Image()
          img.src = frameUrl(shot, ch, i)
          images.push(img)
        }
      }
    }
    return () => images.forEach((img) => (img.src = ''))
  }, [shot, channels, index, frameCount, range])
}
