import type { LensData } from '../api/types'

/**
 * Frontend mirror of the segment value curve in backend services/lens.py.
 * Used to drive the on-image indicators (focal-plane readout, zoom framing)
 * so they show exactly what the render/export will produce.
 *
 * The effect is confined to the segments' outer span — before the first start
 * / after the last end there is no focus/zoom (null → sharp, full frame).
 */

/** Leading millimetres of a focal-length key, e.g. '85mm' → 85. */
export function focalMm(key: string | null | undefined): number | null {
  const m = /^(\d+)/.exec(String(key ?? ''))
  return m ? Number(m[1]) : null
}

const ease = (t: number, smooth: boolean) => (smooth ? t * t * (3 - 2 * t) : t)

interface Node {
  start: number
  end: number
  v: number
}

function valueAt(segs: Node[], frame: number, smooth: boolean): number {
  if (frame <= segs[0].start) return segs[0].v
  if (frame >= segs[segs.length - 1].end) return segs[segs.length - 1].v
  for (const s of segs) if (s.start <= frame && frame <= s.end) return s.v // held
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i]
    const b = segs[i + 1]
    if (a.end < frame && frame < b.start) {
      const span = b.start - a.end
      const t = span === 0 ? 0 : ease((frame - a.end) / span, smooth)
      return a.v + (b.v - a.v) * t
    }
  }
  return segs[segs.length - 1].v
}

function withinSpan(segs: { start: number; end: number }[], frame: number): boolean {
  return segs.length > 0 && segs[0].start <= frame && frame <= segs[segs.length - 1].end
}

/** Focal plane (0..1) at a frame, or null when focus is off/out of span. */
export function focalPlaneAt(lens: LensData, frame: number): number | null {
  const f = lens.focus
  if (!f.enabled || f.follow_subject) return null
  const segs = [...f.segments].sort((a, b) => a.start - b.start)
  if (!withinSpan(segs, frame)) return null
  return valueAt(
    segs.map((s) => ({ start: s.start, end: s.end, v: s.depth })),
    frame,
    f.easing === 'smooth',
  )
}

/** Zoom (scale ≥ 1, center cx/cy) at a frame, or null when out of span. */
export function zoomAt(lens: LensData, frame: number): { scale: number; cx: number; cy: number } | null {
  const z = lens.zoom
  if (!z.enabled) return null
  const segs = [...z.segments].sort((a, b) => a.start - b.start)
  if (!withinSpan(segs, frame)) return null
  const mms = segs.map((s) => focalMm(s.focal) ?? 35)
  const base = Math.min(...mms)
  const scale = Math.max(
    1,
    valueAt(segs.map((s, i) => ({ start: s.start, end: s.end, v: mms[i] / base })), frame, true),
  )
  const cx = valueAt(segs.map((s) => ({ start: s.start, end: s.end, v: s.cx })), frame, true)
  const cy = valueAt(segs.map((s) => ({ start: s.start, end: s.end, v: s.cy })), frame, true)
  return { scale, cx, cy }
}
