import { useRef, useState } from 'react'
import type { ManualSubject } from '../../lib/layoutScene'

type Poly = [number, number][]

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const MIN_POINTS = 6
const MIN_SPAN = 0.03 // reject tiny scribbles (fraction of frame)
const MIN_SIZE = 0.02 // smallest allowed bbox side when resizing
const MOVE_THRESH = 0.004 // drag past this = a move, below = a click (select)
const VB = 1000 // SVG viewBox in per-mille of the frame
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

function bboxOf(p: Poly): BBox {
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

function translate(orig: Poly, dx: number, dy: number): Poly {
  const bb = bboxOf(orig)
  const cdx = clamp(dx, -bb.x0, 1 - bb.x1)
  const cdy = clamp(dy, -bb.y0, 1 - bb.y1)
  return orig.map(([x, y]) => [x + cdx, y + cdy])
}

function resize(orig: Poly, bb: BBox, handle: string, p: [number, number]): Poly {
  let { x0, y0, x1, y1 } = bb
  if (handle.includes('w')) x0 = clamp(Math.min(p[0], x1 - MIN_SIZE))
  if (handle.includes('e')) x1 = clamp(Math.max(p[0], x0 + MIN_SIZE))
  if (handle.includes('n')) y0 = clamp(Math.min(p[1], y1 - MIN_SIZE))
  if (handle.includes('s')) y1 = clamp(Math.max(p[1], y0 + MIN_SIZE))
  const ow = bb.x1 - bb.x0 || 1e-6
  const oh = bb.y1 - bb.y0 || 1e-6
  const sx = (x1 - x0) / ow
  const sy = (y1 - y0) / oh
  return orig.map(([x, y]) => [x0 + (x - bb.x0) * sx, y0 + (y - bb.y0) * sy])
}

type Drag =
  | { kind: 'move'; id: string; start: [number, number]; orig: Poly; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; orig: Poly; bb: BBox }

interface Props {
  manualSubjects: ManualSubject[]
  pendingPolygon: Poly | null // freshly drawn, awaiting the name form — kept visible
  interactive: boolean // overlay + layout on: draw / select / move / resize enabled
  drawMode: boolean // draw-a-new-region mode
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDrawn: (polygon: Poly) => void
  onChangePolygon: (id: string, polygon: Poly) => void
}

/** Freehand lasso + move/resize over the preview image (normalized 0–1 coords). */
export default function LassoDrawLayer({
  manualSubjects,
  pendingPolygon,
  interactive,
  drawMode,
  selectedId,
  onSelect,
  onDrawn,
  onChangePolygon,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [path, setPath] = useState<Poly | null>(null) // new lasso being drawn
  const [live, setLive] = useState<{ id: string; poly: Poly } | null>(null) // move/resize preview
  const drawing = useRef(false)
  const dragRef = useRef<Drag | null>(null)

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const rect = ref.current!.getBoundingClientRect()
    return [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)]
  }
  const capture = (e: React.PointerEvent) => ref.current!.setPointerCapture(e.pointerId)

  // empty-area pointer down: deselect, and start a new lasso when in draw mode
  const onDown = (e: React.PointerEvent) => {
    if (!interactive || e.target !== e.currentTarget) return
    onSelect(null)
    if (!drawMode) return
    drawing.current = true
    capture(e)
    setPath([toNorm(e)])
  }

  const beginMove = (e: React.PointerEvent, s: ManualSubject) => {
    if (!interactive) return
    e.stopPropagation()
    onSelect(s.id)
    capture(e)
    dragRef.current = { kind: 'move', id: s.id, start: toNorm(e), orig: s.polygon, moved: false }
    setLive({ id: s.id, poly: s.polygon })
  }

  const beginResize = (e: React.PointerEvent, s: ManualSubject, handle: string) => {
    if (!interactive) return
    e.stopPropagation()
    capture(e)
    dragRef.current = { kind: 'resize', id: s.id, handle, orig: s.polygon, bb: bboxOf(s.polygon) }
    setLive({ id: s.id, poly: s.polygon })
  }

  const onMove = (e: React.PointerEvent) => {
    if (drawing.current) {
      const p = toNorm(e)
      setPath((cur) => (cur ? [...cur, p] : [p]))
      return
    }
    const d = dragRef.current
    if (!d) return
    const p = toNorm(e)
    if (d.kind === 'move') {
      const dx = p[0] - d.start[0]
      const dy = p[1] - d.start[1]
      if (Math.abs(dx) > MOVE_THRESH || Math.abs(dy) > MOVE_THRESH) d.moved = true
      setLive({ id: d.id, poly: translate(d.orig, dx, dy) })
    } else {
      setLive({ id: d.id, poly: resize(d.orig, d.bb, d.handle, p) })
    }
  }

  const onUp = () => {
    if (drawing.current) {
      drawing.current = false
      const p = path ?? []
      setPath(null)
      if (p.length < MIN_POINTS) return
      const xs = p.map((q) => q[0])
      const ys = p.map((q) => q[1])
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      if (span >= MIN_SPAN) onDrawn(simplify(p))
      return
    }
    const d = dragRef.current
    const l = live
    dragRef.current = null
    setLive(null)
    if (!d || !l) return
    if (d.kind === 'move' && !d.moved) return // was a click → selection only
    onChangePolygon(d.id, l.poly)
  }

  const displayPoly = (s: ManualSubject): Poly => (live && live.id === s.id ? live.poly : s.polygon)
  const toPts = (poly: Poly) => poly.map(([x, y]) => `${x * VB},${y * VB}`).join(' ')

  const selected = interactive ? manualSubjects.find((s) => s.id === selectedId) : undefined
  const selBox = selected ? bboxOf(displayPoly(selected)) : null

  const handlePos: Record<string, [number, number]> = selBox
    ? {
        nw: [selBox.x0, selBox.y0],
        n: [(selBox.x0 + selBox.x1) / 2, selBox.y0],
        ne: [selBox.x1, selBox.y0],
        e: [selBox.x1, (selBox.y0 + selBox.y1) / 2],
        se: [selBox.x1, selBox.y1],
        s: [(selBox.x0 + selBox.x1) / 2, selBox.y1],
        sw: [selBox.x0, selBox.y1],
        w: [selBox.x0, (selBox.y0 + selBox.y1) / 2],
      }
    : {}

  return (
    <div
      ref={ref}
      className={`absolute inset-0 ${interactive && drawMode ? 'cursor-crosshair' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {manualSubjects.map((s) => (
          <polygon
            key={s.id}
            points={toPts(displayPoly(s))}
            className={`${interactive ? 'pointer-events-auto cursor-move' : ''} ${
              s.id === selectedId ? 'fill-cyan-400/25 stroke-cyan-300' : 'fill-cyan-400/10 stroke-cyan-400/60'
            }`}
            strokeWidth={2}
            onPointerDown={(e) => beginMove(e, s)}
          />
        ))}
        {pendingPolygon && pendingPolygon.length > 2 && (
          <polygon
            points={toPts(pendingPolygon)}
            className="pointer-events-none fill-amber-400/20 stroke-amber-300"
            strokeWidth={2}
            strokeDasharray="8 5"
          />
        )}
        {path && path.length > 1 && (
          <polyline
            points={toPts(path)}
            className="pointer-events-none fill-none stroke-cyan-300"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
      </svg>

      {/* selection bbox + resize handles for the selected subject */}
      {selBox && selected && (
        <>
          <div
            className="pointer-events-none absolute border border-dashed border-cyan-300/70"
            style={{
              left: `${selBox.x0 * 100}%`,
              top: `${selBox.y0 * 100}%`,
              width: `${(selBox.x1 - selBox.x0) * 100}%`,
              height: `${(selBox.y1 - selBox.y0) * 100}%`,
            }}
          />
          {HANDLES.map((h) => {
            const [hx, hy] = handlePos[h]
            return (
              <div
                key={h}
                onPointerDown={(e) => beginResize(e, selected, h)}
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-night-950 bg-cyan-300"
                style={{ left: `${hx * 100}%`, top: `${hy * 100}%`, cursor: `${h}-resize` }}
              />
            )
          })}
        </>
      )}
    </div>
  )
}

/** Radial-distance decimation — keeps shape, drops jitter. */
function simplify(points: Poly, tol = 0.008): Poly {
  const out: Poly = [points[0]]
  for (const p of points) {
    const [lx, ly] = out[out.length - 1]
    if (Math.hypot(p[0] - lx, p[1] - ly) >= tol) out.push(p)
  }
  return out.length >= 3 ? out : points
}
