import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExtractionMeta, LensData, PromptMappings, Shot } from '../../api/types'
import {
  getCameraParams,
  getExtraction,
  getLens,
  getPromptMappings,
  lensPreview,
  putLens,
  startLensRender,
} from '../../api/endpoints'
import { frameUrl } from '../../hooks/useFrameUrl'
import { useTaskPolling } from '../../hooks/useTaskPolling'
import { lensPhrases } from '../../lib/lensPhrase'
import FrameSlider, { type SliderMarker } from '../preview/FrameSlider'
import HintBar from '../common/HintBar'
import Button from '../common/Button'

type Mode = 'focus' | 'zoom'
type Source = 'original' | 'live' | 'rendered'

/** Read the depth value (0..1, 1 = near) at a normalized point of a frame. */
async function sampleDepth(shot: Shot, frame: number, nx: number, ny: number): Promise<number> {
  const img = new Image()
  img.src = frameUrl(shot, 'depth', frame)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(
    Math.min(canvas.width - 1, Math.round(nx * canvas.width)),
    Math.min(canvas.height - 1, Math.round(ny * canvas.height)),
    1,
    1,
  ).data
  return px[0] / 255
}

function depthZone(t: (k: string) => string, depth: number): string {
  if (depth >= 0.66) return t('lens.zoneNear')
  if (depth <= 0.33) return t('lens.zoneFar')
  return t('lens.zoneMid')
}

interface Props {
  shot: Shot
  onNext: () => void
}

export default function StepLens({ shot, onNext }: Props) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language !== 'en'
  const [meta, setMeta] = useState<ExtractionMeta | null>(null)
  const [mappings, setMappings] = useState<PromptMappings | null>(null)
  const [lens, setLens] = useState<LensData | null>(null)
  const [frame, setFrame] = useState(0)
  const [mode, setMode] = useState<Mode>('focus')
  const [source, setSource] = useState<Source>('live')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [renderTaskId, setRenderTaskId] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)
  const [error, setError] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasDepth = meta?.channels.includes('depth') ?? false

  const [cameraMoveSet, setCameraMoveSet] = useState(false)

  useEffect(() => {
    Promise.all([getExtraction(shot.id), getLens(shot.id), getPromptMappings(), getCameraParams(shot.id)])
      .then(([m, l, mp, cp]) => {
        setMeta(m)
        setLens(l)
        setMappings(mp)
        setCameraMoveSet(Boolean(cp.camera_move))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [shot.id])

  const save = useCallback(
    (next: LensData) => {
      setLens(next)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => putLens(shot.id, next).catch(console.error), 800)
    },
    [shot.id],
  )

  const lensActive =
    lens != null &&
    ((lens.focus.enabled && lens.focus.keyframes.length > 0) ||
      (lens.zoom.enabled && lens.zoom.keyframes.length > 0))

  // Live single-frame preview (debounced against scrubbing / param edits).
  useEffect(() => {
    if (!lens || source !== 'live' || !lensActive) return
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      lensPreview(shot.id, frame, lens)
        .then((url) =>
          setPreviewUrl((old) => {
            if (old) URL.revokeObjectURL(old)
            return url
          }),
        )
        .catch(console.error)
    }, 220)
  }, [lens, frame, source, lensActive, shot.id])

  const renderTask = useTaskPolling(renderTaskId, (snapshot) => {
    setRenderTaskId(null)
    if (snapshot.status === 'done') {
      setRendered(true)
      setSource('rendered')
    } else if (snapshot.error) {
      setError(snapshot.error)
    }
  })
  const rendering = renderTask !== null && ['queued', 'running'].includes(renderTask.status)

  const handleImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!lens) return
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height

    if (mode === 'focus') {
      if (!hasDepth) return
      try {
        const depth = await sampleDepth(shot, frame, nx, ny)
        const keyframes = lens.focus.keyframes.filter((k) => k.frame !== frame)
        keyframes.push({ frame, depth, label: '' })
        keyframes.sort((a, b) => a.frame - b.frame)
        save({ ...lens, focus: { ...lens.focus, enabled: true, keyframes } })
        setSource('live')
      } catch (err) {
        console.error(err)
      }
    } else {
      const existing = lens.zoom.keyframes.find((k) => k.frame === frame)
      const keyframes = lens.zoom.keyframes.filter((k) => k.frame !== frame)
      keyframes.push({ frame, focal: existing?.focal ?? '50mm', cx: nx, cy: ny })
      keyframes.sort((a, b) => a.frame - b.frame)
      save({ ...lens, zoom: { ...lens.zoom, enabled: true, keyframes } })
      setSource('live')
    }
  }

  const markers = useMemo<SliderMarker[]>(() => {
    if (!lens) return []
    return [
      ...lens.focus.keyframes.map((k) => ({ frame: k.frame, color: 'bg-cyan-400', lane: 0 })),
      ...lens.zoom.keyframes.map((k) => ({ frame: k.frame, color: 'bg-violet-400', lane: 1 })),
    ]
  }, [lens])

  const phrases = useMemo(
    () => (lens && mappings ? lensPhrases(lens, mappings, cameraMoveSet) : []),
    [lens, mappings, cameraMoveSet],
  )

  if (error && !meta)
    return <p className="py-16 text-center text-sm text-red-300">{error}</p>
  if (!meta || !lens || !mappings)
    return <p className="py-16 text-center text-sm text-slate-500">{t('common.loading')}</p>

  const focusKfAtFrame = lens.focus.keyframes.find((k) => k.frame === frame)
  const imageSrc =
    source === 'rendered' && rendered
      ? frameUrl(shot, 'dof', frame)
      : source === 'live' && lensActive && previewUrl
        ? previewUrl
        : frameUrl(shot, 'frames', frame)

  const box = 'rounded-xl border border-night-700 bg-night-800 p-4'
  const smallSelect =
    'rounded-md border border-night-600 bg-night-900 px-1.5 py-1 text-[11px] text-slate-200 focus:border-accent focus:outline-none'

  return (
    <div className="flex flex-col gap-4">
      <HintBar text={t('lens.hintBar')} />
      <div className="flex gap-4">
        {/* Viewer */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {/* source */}
            <div className="flex rounded-lg border border-night-600 p-0.5">
              {(['original', 'live', 'rendered'] as const).map((s) => (
                <button
                  key={s}
                  disabled={s === 'rendered' && !rendered}
                  onClick={() => setSource(s)}
                  className={`rounded-md px-2.5 py-1 text-xs transition disabled:opacity-30 ${
                    source === s ? 'bg-night-700 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t(`lens.source.${s}`)}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-600">
              {mode === 'focus'
                ? hasDepth
                  ? t('lens.clickHintFocus')
                  : t('lens.noDepth')
                : t('lens.clickHintZoom')}
            </span>
          </div>

          <div className="rounded-xl border border-night-700 bg-night-900/60 p-3">
            <div
              className={`relative mx-auto w-fit ${mode === 'focus' && hasDepth ? 'cursor-crosshair' : mode === 'zoom' ? 'cursor-crosshair' : ''}`}
              onClick={handleImageClick}
            >
              <img src={imageSrc} alt="" draggable={false} className="block max-h-[56vh] rounded-lg" />
              {/* focus marker for the current frame's keyframe */}
              {focusKfAtFrame && source !== 'rendered' && (
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-cyan-300"
                  style={{ left: '50%', top: '8px' }}
                >
                  <span className="rounded bg-night-950/80 px-1.5 py-0.5 text-[10px] backdrop-blur">
                    {t('lens.focalPlane')} {Math.round(focusKfAtFrame.depth * 100)}% ·{' '}
                    {depthZone(t, focusKfAtFrame.depth)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2.5">
            <FrameSlider
              index={frame}
              frameCount={meta.frame_count}
              effectiveFps={meta.effective_fps}
              onChange={setFrame}
              markers={markers}
            />
            <div className="mt-0.5 flex gap-4 text-[10px] text-slate-600">
              <span className="flex items-center gap-1">
                <i className="h-1.5 w-1.5 rotate-45 rounded-[1px] bg-cyan-400" /> {t('lens.laneFocus')}
              </span>
              <span className="flex items-center gap-1">
                <i className="h-1.5 w-1.5 rotate-45 rounded-[1px] bg-violet-400" /> {t('lens.laneZoom')}
              </span>
            </div>
          </div>
        </div>

        {/* Panel */}
        <aside className="flex w-72 shrink-0 flex-col gap-3">
          {/* Mode switch: blue = focus, violet = zoom */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMode('focus')}
              className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                mode === 'focus'
                  ? 'border-cyan-400/70 bg-cyan-950/50 text-cyan-300 shadow-lg shadow-cyan-950/40'
                  : 'border-night-600 text-slate-500 hover:border-night-500 hover:text-slate-300'
              }`}
            >
              {t('lens.mode.focus')}
            </button>
            <button
              onClick={() => setMode('zoom')}
              className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                mode === 'zoom'
                  ? 'border-violet-400/70 bg-violet-950/50 text-violet-300 shadow-lg shadow-violet-950/40'
                  : 'border-night-600 text-slate-500 hover:border-night-500 hover:text-slate-300'
              }`}
            >
              {t('lens.mode.zoom')}
            </button>
          </div>

          {/* Focus */}
          <div className={box}>
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-sm font-medium text-slate-200">{t('lens.focusTitle')}</span>
              <input
                type="checkbox"
                checked={lens.focus.enabled}
                onChange={(e) => save({ ...lens, focus: { ...lens.focus, enabled: e.target.checked } })}
                className="accent-cyan-400"
              />
            </label>
            {!hasDepth && <p className="mt-1 text-[10px] text-amber-400">{t('lens.noDepth')}</p>}
            <div className="mt-2 flex flex-col gap-1.5">
              {lens.focus.keyframes.length === 0 && (
                <p className="text-[11px] text-slate-600">{t('lens.noFocusKfs')}</p>
              )}
              {lens.focus.keyframes.map((kf) => (
                <div
                  key={kf.frame}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                    kf.frame === frame ? 'border-cyan-500/50 bg-night-900' : 'border-night-700'
                  }`}
                >
                  <button onClick={() => setFrame(kf.frame)} className="font-mono text-[10px] text-slate-400 hover:text-cyan-300">
                    #{kf.frame + 1}
                  </button>
                  <span className="text-[10px] text-cyan-300">{Math.round(kf.depth * 100)}%</span>
                  <input
                    value={kf.label}
                    placeholder={t('lens.labelPlaceholder')}
                    onChange={(e) =>
                      save({
                        ...lens,
                        focus: {
                          ...lens.focus,
                          keyframes: lens.focus.keyframes.map((k) =>
                            k.frame === kf.frame ? { ...k, label: e.target.value } : k,
                          ),
                        },
                      })
                    }
                    className="min-w-0 flex-1 rounded border border-night-700 bg-night-900 px-1.5 py-0.5 text-[10px] text-slate-300 placeholder:text-slate-700 focus:border-accent focus:outline-none"
                  />
                  <button
                    onClick={() =>
                      save({
                        ...lens,
                        focus: {
                          ...lens.focus,
                          keyframes: lens.focus.keyframes.filter((k) => k.frame !== kf.frame),
                        },
                      })
                    }
                    className="text-slate-600 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2 text-[11px] text-slate-400">
              <label className="flex items-center justify-between gap-2">
                {t('lens.maxBlur')}
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={lens.focus.max_blur}
                  onChange={(e) => save({ ...lens, focus: { ...lens.focus, max_blur: Number(e.target.value) } })}
                  className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-night-700 accent-cyan-400"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                {t('lens.falloff')}
                <input
                  type="range"
                  min={10}
                  max={80}
                  value={lens.focus.falloff * 100}
                  onChange={(e) => save({ ...lens, focus: { ...lens.focus, falloff: Number(e.target.value) / 100 } })}
                  className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-night-700 accent-cyan-400"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                {t('lens.easing')}
                <select
                  className={smallSelect}
                  value={lens.focus.easing}
                  onChange={(e) =>
                    save({ ...lens, focus: { ...lens.focus, easing: e.target.value as 'linear' | 'smooth' } })
                  }
                >
                  <option value="smooth">{t('lens.easeSmooth')}</option>
                  <option value="linear">{t('lens.easeLinear')}</option>
                </select>
              </label>
            </div>
          </div>

          {/* Zoom / focal */}
          <div className={box}>
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-sm font-medium text-slate-200">{t('lens.zoomTitle')}</span>
              <input
                type="checkbox"
                checked={lens.zoom.enabled}
                onChange={(e) => save({ ...lens, zoom: { ...lens.zoom, enabled: e.target.checked } })}
                className="accent-violet-400"
              />
            </label>
            <div className="mt-2 flex flex-col gap-1.5">
              {lens.zoom.keyframes.length === 0 && (
                <p className="text-[11px] text-slate-600">{t('lens.noZoomKfs')}</p>
              )}
              {lens.zoom.keyframes.map((kf) => (
                <div
                  key={kf.frame}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                    kf.frame === frame ? 'border-violet-500/50 bg-night-900' : 'border-night-700'
                  }`}
                >
                  <button onClick={() => setFrame(kf.frame)} className="font-mono text-[10px] text-slate-400 hover:text-violet-300">
                    #{kf.frame + 1}
                  </button>
                  <select
                    className={smallSelect}
                    value={kf.focal}
                    onChange={(e) =>
                      save({
                        ...lens,
                        zoom: {
                          ...lens.zoom,
                          keyframes: lens.zoom.keyframes.map((k) =>
                            k.frame === kf.frame ? { ...k, focal: e.target.value } : k,
                          ),
                        },
                      })
                    }
                  >
                    {mappings.focal_lengths.map((o) => (
                      <option key={o.key} value={o.key}>
                        {zh ? o.label_zh : o.label_en}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      save({
                        ...lens,
                        zoom: { ...lens.zoom, keyframes: lens.zoom.keyframes.filter((k) => k.frame !== kf.frame) },
                      })
                    }
                    className="ml-auto text-slate-600 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[10px] leading-relaxed text-slate-600">{t('lens.zoomHint')}</p>
            {lens.zoom.keyframes.length < 2 && (
              <label className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                {t('lens.staticFocal')}
                <select
                  className={smallSelect}
                  value={lens.focal ?? ''}
                  onChange={(e) => save({ ...lens, focal: e.target.value || null })}
                >
                  <option value="">{t('camera.unspecified')}</option>
                  {mappings.focal_lengths.map((o) => (
                    <option key={o.key} value={o.key}>
                      {zh ? o.label_zh : o.label_en}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Prompt phrases */}
          <div className={box}>
            <div className="text-[11px] font-medium text-slate-400">{t('lens.promptWillInclude')}</div>
            {phrases.length > 0 ? (
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-indigo-300">
                {phrases.join(', ')}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-600">{t('lens.noPhrases')}</p>
            )}
          </div>
        </aside>
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-3">
        {error && <span className="text-xs text-red-300">{error}</span>}
        {rendering && renderTask ? (
          <div className="flex flex-1 items-center gap-3">
            <div className="h-1.5 max-w-64 flex-1 overflow-hidden rounded-full bg-night-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-glow transition-all"
                style={{ width: `${Math.round(renderTask.progress * 100)}%` }}
              />
            </div>
            <span className="text-[11px] text-slate-500">{renderTask.stage}</span>
          </div>
        ) : (
          <Button
            variant="ghost"
            disabled={!lens.focus.enabled || lens.focus.keyframes.length === 0 || !hasDepth}
            onClick={async () => {
              setError('')
              try {
                const { task_id } = await startLensRender(shot.id)
                setRenderTaskId(task_id)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {t('lens.renderSequence')}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onNext}>
            {t('lens.skip')}
          </Button>
          <Button onClick={onNext}>{t('common.next')} →</Button>
        </div>
      </div>
    </div>
  )
}
