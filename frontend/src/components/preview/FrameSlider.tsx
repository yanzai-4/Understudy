interface Props {
  index: number
  frameCount: number
  effectiveFps: number
  onChange: (index: number) => void
}

function timecode(index: number, fps: number): string {
  const sec = index / Math.max(0.01, fps)
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const f = Math.round((sec - Math.floor(sec)) * fps)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`
}

export default function FrameSlider({ index, frameCount, effectiveFps, onChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={Math.max(0, frameCount - 1)}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-night-700 accent-cyan-400"
      />
      <div className="w-32 shrink-0 text-right font-mono text-[11px] text-slate-500">
        {index + 1}/{frameCount} · {timecode(index, effectiveFps)}
      </div>
    </div>
  )
}
