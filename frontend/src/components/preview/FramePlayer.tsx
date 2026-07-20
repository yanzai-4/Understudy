import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExtractionMeta, Shot } from '../../api/types'
import { usePreloadFrames } from '../../hooks/useFrameUrl'
import ChannelToggle from './ChannelToggle'
import FrameSlider from './FrameSlider'
import OverlayView from './OverlayView'
import SplitView from './SplitView'

interface Props {
  shot: Shot
  meta: ExtractionMeta
  overlayExtras?: ReactNode // e.g. background-edit draw layer (overlay mode only)
  frameIndex?: number
  onFrameChange?: (index: number) => void
}

export default function FramePlayer({ shot, meta, overlayExtras, frameIndex, onFrameChange }: Props) {
  const { t } = useTranslation()
  const [internalIndex, setInternalIndex] = useState(0)
  const index = frameIndex ?? internalIndex
  const setIndex = (i: number) => {
    setInternalIndex(i)
    onFrameChange?.(i)
  }

  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<'overlay' | 'split'>('overlay')
  const [overlayChannels, setOverlayChannels] = useState<string[]>(
    meta.channels.filter((c) => c === 'pose'),
  )
  const [depthOpacity, setDepthOpacity] = useState(0.5)
  const indexRef = useRef(index)
  indexRef.current = index

  usePreloadFrames(shot, ['frames', ...meta.channels], index, meta.frame_count)

  useEffect(() => {
    if (!playing) return
    const interval = setInterval(
      () => {
        const next = (indexRef.current + 1) % meta.frame_count
        setInternalIndex(next)
        onFrameChange?.(next)
      },
      1000 / Math.max(1, meta.effective_fps),
    )
    return () => clearInterval(interval)
  }, [playing, meta]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-night-600 p-0.5">
          {(['overlay', 'split'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                mode === m ? 'bg-night-700 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t(`preview.mode.${m}`)}
            </button>
          ))}
        </div>
        {mode === 'overlay' && (
          <>
            <ChannelToggle
              available={meta.channels}
              active={overlayChannels}
              onChange={setOverlayChannels}
            />
            {overlayChannels.includes('depth') && (
              <label className="flex items-center gap-2 text-[11px] text-slate-500">
                {t('preview.depthOpacity')}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={depthOpacity * 100}
                  onChange={(e) => setDepthOpacity(Number(e.target.value) / 100)}
                  className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-night-700 accent-sky-400"
                />
              </label>
            )}
          </>
        )}
      </div>

      {/* Viewport */}
      <div className="rounded-xl border border-night-700 bg-night-900/60 p-3">
        {mode === 'overlay' ? (
          <OverlayView
            shot={shot}
            index={index}
            channels={overlayChannels}
            depthOpacity={depthOpacity}
          >
            {overlayExtras}
          </OverlayView>
        ) : (
          <SplitView shot={shot} index={index} channels={meta.channels} />
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-night-600 text-slate-300 transition hover:border-accent hover:text-cyan-300"
        >
          {playing ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="4" width="5" height="16" rx="1" />
              <rect x="14" y="4" width="5" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4.5v15l13-7.5z" />
            </svg>
          )}
        </button>
        <div className="flex-1">
          <FrameSlider
            index={index}
            frameCount={meta.frame_count}
            effectiveFps={meta.effective_fps}
            onChange={(i) => {
              setPlaying(false)
              setIndex(i)
            }}
          />
        </div>
      </div>
    </div>
  )
}
