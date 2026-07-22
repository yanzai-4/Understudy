import { useRef, useState } from 'react'

/** Geometry-only view of a segment; the parent owns the value fields. */
export interface TrackSegment {
  start: number
  end: number
  label: string
}

type Accent = 'cyan' | 'violet'

const ACCENT: Record<Accent, { bar: string; sel: string; edge: string; junc: string; ghost: string }> = {
  cyan: {
    bar: 'bg-cyan-500/25 border-cyan-500/50 text-cyan-200',
    sel: 'bg-cyan-500/50 border-cyan-300 text-white ring-2 ring-cyan-300 z-10',
    edge: 'bg-cyan-400',
    junc: 'bg-cyan-300',
    ghost: 'bg-cyan-500/20 border-cyan-400/40',
  },
  violet: {
    bar: 'bg-violet-500/25 border-violet-500/50 text-violet-200',
    sel: 'bg-violet-500/50 border-violet-300 text-white ring-2 ring-violet-300 z-10',
    edge: 'bg-violet-400',
    junc: 'bg-violet-300',
    ghost: 'bg-violet-500/20 border-violet-400/40',
  },
}

interface Props {
  segments: TrackSegment[]
  frameCount: number
  accent: Accent
  selected: number | null
  /** Current playhead frame — drawn as a vertical line using the same
   * positioning as the bars, so it always lines up with them. */
  playhead?: number
  disabled?: boolean
  /** New start/end for every existing segment (same order & length). */
  onGeometry: (geo: { start: number; end: number }[]) => void
  /** The user drew a fresh segment over a free range. */
  onDraw: (start: number, end: number) => void
  onSelect: (index: number | null) => void
}

type Drag =
  | { type: 'start' | 'end'; index: number }
  | { type: 'junction'; index: number } // between index and index+1
  | { type: 'draw'; anchor: number; lo: number; hi: number }

export default function SegmentTrack({
  segments,
  frameCount,
  accent,
  selected,
  playhead,
  disabled,
  onGeometry,
  onDraw,
  onSelect,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [ghost, setGhost] = useState<{ lo: number; hi: number } | null>(null)
  const a = ACCENT[accent]
  const maxF = Math.max(1, frameCount - 1)
  const pct = (f: number) => `${(f / maxF) * 100}%`

  const frameAt = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect()
    const f = Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * maxF)
    return Math.max(0, Math.min(maxF, f))
  }

  /** Free range [lo, hi] around frame f, or null if f lands inside a segment. */
  const gapAround = (f: number): [number, number] | null => {
    for (const s of segments) if (s.start <= f && f <= s.end) return null
    let lo = 0
    let hi = maxF
    for (const s of segments) {
      if (s.end < f) lo = Math.max(lo, s.end)
      if (s.start > f) hi = Math.min(hi, s.start)
    }
    return [lo, hi]
  }

  const beginDrag = (e: React.PointerEvent, drag: Drag) => {
    if (disabled) return
    e.stopPropagation()
    dragRef.current = drag
    trackRef.current?.setPointerCapture(e.pointerId)
  }

  const onTrackDown = (e: React.PointerEvent) => {
    if (disabled) return
    const f = frameAt(e.clientX)
    const gap = gapAround(f)
    if (!gap) return // pointer landed on a bar; its own handler selects it
    trackRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { type: 'draw', anchor: f, lo: gap[0], hi: gap[1] }
    setGhost({ lo: f, hi: f })
  }

  const onMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const f = frameAt(e.clientX)
    if (drag.type === 'draw') {
      const lo = Math.max(drag.lo, Math.min(drag.anchor, f))
      const hi = Math.min(drag.hi, Math.max(drag.anchor, f))
      setGhost({ lo, hi })
      return
    }
    const geo = segments.map((s) => ({ start: s.start, end: s.end }))
    if (drag.type === 'start') {
      const lo = drag.index > 0 ? geo[drag.index - 1].end : 0
      geo[drag.index].start = Math.max(lo, Math.min(f, geo[drag.index].end))
    } else if (drag.type === 'end') {
      const hi = drag.index < geo.length - 1 ? geo[drag.index + 1].start : maxF
      geo[drag.index].end = Math.min(hi, Math.max(f, geo[drag.index].start))
    } else {
      // junction: move the shared edge of index / index+1 together
      const pos = Math.max(geo[drag.index].start, Math.min(f, geo[drag.index + 1].end))
      geo[drag.index].end = pos
      geo[drag.index + 1].start = pos
    }
    onGeometry(geo)
  }

  const onUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    trackRef.current?.releasePointerCapture(e.pointerId)
    if (drag?.type === 'draw' && ghost) {
      let { lo, hi } = ghost
      if (hi - lo < 1) {
        // A tap, not a drag: drop a default-length segment inside the gap.
        const def = Math.max(2, Math.round(frameCount / 6))
        hi = Math.min(drag.hi, lo + def)
        if (hi - lo < 1) lo = Math.max(drag.lo, hi - def) // clamped at the right edge
      }
      if (hi - lo >= 1) onDraw(lo, hi)
    }
    setGhost(null)
  }

  return (
    <div
      ref={trackRef}
      onPointerDown={onTrackDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      className={`relative h-7 rounded-md border border-night-700 bg-night-900/60 ${
        disabled ? 'opacity-40' : 'cursor-crosshair'
      }`}
    >
      {segments.map((s, i) => {
        const touchesPrev = i > 0 && segments[i - 1].end === s.start
        const touchesNext = i < segments.length - 1 && s.end === segments[i + 1].start
        const left = (s.start / maxF) * 100
        const width = ((s.end - s.start) / maxF) * 100
        return (
          <div key={i}>
            {/* bar body — click to select */}
            <button
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelect(i)
              }}
              className={`absolute top-1 flex h-5 items-center justify-center overflow-hidden rounded border px-1 text-[9px] font-medium ${
                selected === i ? a.sel : a.bar
              }`}
              style={{ left: `${left}%`, width: `max(10px, ${width}%)` }}
              title={s.label}
            >
              <span className="truncate">{s.label}</span>
            </button>
            {/* left edge handle (unless a junction owns it) */}
            {!touchesPrev && !disabled && (
              <div
                onPointerDown={(e) => beginDrag(e, { type: 'start', index: i })}
                className={`absolute top-0.5 h-6 w-1.5 -translate-x-1/2 cursor-ew-resize rounded-full ${a.edge}`}
                style={{ left: pct(s.start) }}
              />
            )}
            {/* right edge handle (unless a junction owns it) */}
            {!touchesNext && !disabled && (
              <div
                onPointerDown={(e) => beginDrag(e, { type: 'end', index: i })}
                className={`absolute top-0.5 h-6 w-1.5 -translate-x-1/2 cursor-ew-resize rounded-full ${a.edge}`}
                style={{ left: pct(s.end) }}
              />
            )}
            {/* junction diamond — drags both neighbours together */}
            {touchesNext && !disabled && (
              <div
                onPointerDown={(e) => beginDrag(e, { type: 'junction', index: i })}
                title="交汇点"
                className={`absolute top-1.5 h-3 w-3 -translate-x-1/2 rotate-45 cursor-ew-resize rounded-[2px] ${a.junc} ring-1 ring-night-900`}
                style={{ left: pct(s.end) }}
              />
            )}
          </div>
        )
      })}
      {ghost && (
        <div
          className={`pointer-events-none absolute top-1 h-5 rounded border border-dashed ${a.ghost}`}
          style={{ left: pct(ghost.lo), width: pct(ghost.hi - ghost.lo) }}
        />
      )}
      {playhead != null && (
        <div
          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white/80"
          style={{ left: pct(playhead) }}
        />
      )}
    </div>
  )
}
