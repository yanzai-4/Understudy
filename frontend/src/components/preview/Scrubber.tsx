import { useRef } from 'react'

/**
 * Playhead scrubber whose thumb CENTER sits at (frame / (frameCount-1)) of the
 * rail — the exact same math SegmentTrack uses for bars and its playhead line —
 * so the thumb always lines up with the tracks below (unlike a native range
 * input, whose thumb is inset by half its width at the two ends).
 */
interface Props {
  frame: number
  frameCount: number
  onSeek: (frame: number) => void
}

export default function Scrubber({ frame, frameCount, onSeek }: Props) {
  const railRef = useRef<HTMLDivElement>(null)
  const maxF = Math.max(1, frameCount - 1)
  const pct = (frame / maxF) * 100

  const seek = (clientX: number) => {
    const r = railRef.current!.getBoundingClientRect()
    const f = Math.round(((clientX - r.left) / Math.max(1, r.width)) * maxF)
    onSeek(Math.max(0, Math.min(maxF, f)))
  }

  return (
    <div
      ref={railRef}
      onPointerDown={(e) => {
        railRef.current?.setPointerCapture(e.pointerId)
        seek(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.buttons) seek(e.clientX)
      }}
      className="relative h-4 cursor-pointer select-none"
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-night-700" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-cyan-500/50"
        style={{ left: 0, width: `${pct}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400 ring-2 ring-night-900"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}
