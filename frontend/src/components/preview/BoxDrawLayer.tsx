import { useRef, useState } from 'react'
import type { EditType } from '../../api/types'

export interface NormBox {
  x: number
  y: number
  w: number
  h: number
}

export interface EditBox extends NormBox {
  id: number
  edit_type: EditType
  label: string
}

const TYPE_COLORS: Record<EditType, { border: string; bg: string }> = {
  remove: { border: 'border-red-400', bg: 'bg-red-500/15' },
  add: { border: 'border-emerald-400', bg: 'bg-emerald-500/15' },
  replace: { border: 'border-blue-400', bg: 'bg-blue-500/15' },
}

type DragState =
  | { kind: 'draw'; startX: number; startY: number }
  | { kind: 'move'; id: number; startX: number; startY: number; orig: NormBox }
  | { kind: 'resize'; id: number; handle: string; orig: NormBox }

interface Props {
  boxes: EditBox[]
  selectedId: number | null
  drawMode: boolean
  onSelect: (id: number | null) => void
  onDrawn: (box: NormBox) => void
  onBoxChange: (id: number, box: NormBox) => void
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

/** Interactive rectangle layer over the preview image (normalized 0–1 coords). */
export default function BoxDrawLayer({
  boxes,
  selectedId,
  drawMode,
  onSelect,
  onDrawn,
  onBoxChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [draft, setDraft] = useState<NormBox | null>(null) // live box during any drag
  const dragRef = useRef<DragState | null>(null)
  const draftRef = useRef<NormBox | null>(null)

  const toNorm = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = ref.current!.getBoundingClientRect()
    return {
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    }
  }

  const begin = (state: DragState, e: React.PointerEvent) => {
    dragRef.current = state
    setDrag(state)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const setLiveDraft = (box: NormBox | null) => {
    draftRef.current = box
    setDraft(box)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return // boxes handle their own drags
    onSelect(null)
    if (!drawMode) return
    const p = toNorm(e)
    begin({ kind: 'draw', startX: p.x, startY: p.y }, e)
    setLiveDraft({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const state = dragRef.current
    if (!state) return
    const p = toNorm(e)

    if (state.kind === 'draw') {
      setLiveDraft({
        x: Math.min(state.startX, p.x),
        y: Math.min(state.startY, p.y),
        w: Math.abs(p.x - state.startX),
        h: Math.abs(p.y - state.startY),
      })
    } else if (state.kind === 'move') {
      const dx = p.x - state.startX
      const dy = p.y - state.startY
      setLiveDraft({
        x: clamp(state.orig.x + dx, 0, 1 - state.orig.w),
        y: clamp(state.orig.y + dy, 0, 1 - state.orig.h),
        w: state.orig.w,
        h: state.orig.h,
      })
    } else {
      const { orig, handle } = state
      let x0 = orig.x
      let y0 = orig.y
      let x1 = orig.x + orig.w
      let y1 = orig.y + orig.h
      if (handle.includes('w')) x0 = clamp(Math.min(p.x, x1 - 0.01))
      if (handle.includes('e')) x1 = clamp(Math.max(p.x, x0 + 0.01))
      if (handle.includes('n')) y0 = clamp(Math.min(p.y, y1 - 0.01))
      if (handle.includes('s')) y1 = clamp(Math.max(p.y, y0 + 0.01))
      setLiveDraft({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    }
  }

  const onPointerUp = () => {
    const state = dragRef.current
    const box = draftRef.current
    dragRef.current = null
    setDrag(null)
    setLiveDraft(null)
    if (!state || !box) return
    if (state.kind === 'draw') {
      if (box.w > 0.015 && box.h > 0.015) onDrawn(box)
    } else {
      onBoxChange(state.id, box)
    }
  }

  const displayBox = (b: EditBox): NormBox =>
    drag && drag.kind !== 'draw' && drag.id === b.id && draft ? draft : b

  return (
    <div
      ref={ref}
      className={`absolute inset-0 ${drawMode ? 'cursor-crosshair' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {boxes.map((b) => {
        const pos = displayBox(b)
        const colors = TYPE_COLORS[b.edit_type]
        const selected = b.id === selectedId
        return (
          <div
            key={b.id}
            className={`absolute border-2 ${colors.border} ${colors.bg} ${
              selected ? 'z-10' : 'opacity-75'
            } cursor-move`}
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              width: `${pos.w * 100}%`,
              height: `${pos.h * 100}%`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelect(b.id)
              const p = toNorm(e)
              begin({ kind: 'move', id: b.id, startX: p.x, startY: p.y, orig: { ...b } }, e)
              setLiveDraft({ x: b.x, y: b.y, w: b.w, h: b.h })
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <span className="absolute -top-5 left-0 max-w-full truncate rounded bg-night-950/85 px-1.5 py-px text-[10px] text-slate-200 backdrop-blur">
              {b.label}
            </span>
            {selected &&
              HANDLES.map((h) => (
                <div
                  key={h}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    begin({ kind: 'resize', id: b.id, handle: h, orig: { ...b } }, e)
                    setLiveDraft({ x: b.x, y: b.y, w: b.w, h: b.h })
                  }}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className={`absolute h-2.5 w-2.5 rounded-sm border border-night-950 bg-cyan-300 ${handlePos(h)}`}
                  style={{ cursor: `${h}-resize` }}
                />
              ))}
          </div>
        )
      })}
      {/* live draw preview */}
      {drag?.kind === 'draw' && draft && (
        <div
          className="absolute border-2 border-dashed border-cyan-300 bg-cyan-400/10"
          style={{
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            width: `${draft.w * 100}%`,
            height: `${draft.h * 100}%`,
          }}
        />
      )}
    </div>
  )
}

function handlePos(h: string): string {
  const v = h.includes('n') ? '-top-1.5' : h.includes('s') ? '-bottom-1.5' : 'top-1/2 -translate-y-1/2'
  const hz = h.includes('w') ? '-left-1.5' : h.includes('e') ? '-right-1.5' : 'left-1/2 -translate-x-1/2'
  return `${v} ${hz}`
}
