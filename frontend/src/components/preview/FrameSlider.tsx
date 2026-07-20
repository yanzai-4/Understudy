export interface SliderMarker {
  frame: number
  color: string // tailwind bg class
  lane?: number // 0 = first lane below the track, 1 = second lane…
}

interface Props {
  index: number
  frameCount: number
  effectiveFps: number
  onChange: (index: number) => void
  /** Keyframe diamonds rendered under the track (click to jump). */
  markers?: SliderMarker[]
}

function timecode(index: number, fps: number): string {
  const sec = index / Math.max(0.01, fps)
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const f = Math.round((sec - Math.floor(sec)) * fps)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`
}

export default function FrameSlider({ index, frameCount, effectiveFps, onChange, markers }: Props) {
  const lanes = markers?.length ? Math.max(...markers.map((m) => (m.lane ?? 0))) + 1 : 0

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={index}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-night-700 accent-cyan-400"
        />
        {lanes > 0 && (
          <div className="relative" style={{ height: lanes * 10 + 2 }}>
            {markers!.map((m, i) => (
              <button
                key={i}
                title={`#${m.frame + 1}`}
                onClick={() => onChange(m.frame)}
                className={`absolute h-2 w-2 rotate-45 rounded-[2px] ${m.color} transition-transform hover:scale-125`}
                style={{
                  left: `calc(${(m.frame / Math.max(1, frameCount - 1)) * 100}% - 4px)`,
                  top: (m.lane ?? 0) * 10,
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="w-32 shrink-0 text-right font-mono text-[11px] text-slate-500">
        {index + 1}/{frameCount} · {timecode(index, effectiveFps)}
      </div>
    </div>
  )
}
