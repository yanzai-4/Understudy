import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ExtractionMeta,
  FocusSegment,
  LensData,
  PromptMappings,
  Shot,
  ZoomSegment,
} from '../../api/types'
import { SEGMENT_CAP } from '../../api/types'
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
import { focalPlaneAt, zoomAt } from '../../lib/lensCurve'
import SegmentTrack, { type TrackSegment } from '../preview/SegmentTrack'
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

function timecode(index: number, fps: number): string {
  const sec = index / Math.max(0.01, fps)
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const f = Math.round((sec - Math.floor(sec)) * fps)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`
}

/** Widest free range for a new segment, or null if the track is full. */
function newRange(segs: { start: number; end: number }[], frameCount: number): [number, number] | null {
  const maxF = frameCount - 1
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  const gaps: [number, number][] = []
  let cursor = 0
  for (const s of sorted) {
    if (s.start > cursor) gaps.push([cursor, s.start])
    cursor = Math.max(cursor, s.end)
  }
  if (cursor < maxF) gaps.push([cursor, maxF])
  gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
  if (!gaps.length || gaps[0][1] - gaps[0][0] < 1) return null
  const [lo, hi] = gaps[0]
  const width = Math.min(hi - lo, Math.max(2, Math.round(frameCount / 4)))
  return [lo, Math.min(hi, lo + width)]
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
  const [selFocus, setSelFocus] = useState<number | null>(null)
  const [selZoom, setSelZoom] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [renderTaskId, setRenderTaskId] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)
  const [error, setError] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasDepth = meta?.channels.includes('depth') ?? false
  const hasPose = meta?.channels.includes('pose') ?? false

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

  const followOn = lens?.focus.enabled === true && lens.focus.follow_subject && hasPose && hasDepth
  const lensActive =
    lens != null &&
    ((lens.focus.enabled && (lens.focus.segments.length > 0 || followOn)) ||
      (lens.zoom.enabled && lens.zoom.segments.length > 0))

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

  // Which focus/zoom segment a click on the image should write to: the one
  // under the playhead (what the indicator shows), else the selected one.
  const targetIndex = (segs: { start: number; end: number }[], sel: number | null): number | null => {
    const i = segs.findIndex((s) => s.start <= frame && frame <= s.end)
    if (i >= 0) return i
    return sel != null && sel < segs.length ? sel : null
  }

  const handleImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!lens) return
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height

    if (mode === 'focus') {
      if (!hasDepth || followOn) return
      const i = targetIndex(lens.focus.segments, selFocus)
      if (i == null) {
        setError(t('lens.selectSegmentFirst'))
        return
      }
      setError('')
      try {
        const depth = await sampleDepth(shot, frame, nx, ny)
        setFocusSegments(lens.focus.segments.map((s, j) => (j === i ? { ...s, depth } : s)))
      } catch (err) {
        console.error(err)
      }
    } else {
      const i = targetIndex(lens.zoom.segments, selZoom)
      if (i == null) {
        setError(t('lens.selectSegmentFirst'))
        return
      }
      setError('')
      setZoomSegments(lens.zoom.segments.map((s, j) => (j === i ? { ...s, cx: nx, cy: ny } : s)))
    }
  }

  // An edit that produces an effect leaves the clean 'original' view for 'live'.
  const toLive = () => setSource((s) => (s === 'original' ? 'live' : s))

  // Selecting a segment makes it the single active one (clears the other lane)
  // and moves the playhead into it so the frame-driven indicator shows it.
  const jumpInto = (seg?: { start: number; end: number }) => {
    if (seg && (frame < seg.start || frame > seg.end)) {
      setFrame(Math.round((seg.start + seg.end) / 2))
    }
  }
  const selectFocus = (i: number | null, seg?: { start: number; end: number }) => {
    setSelFocus(i)
    setSelZoom(null)
    setMode('focus')
    jumpInto(seg)
  }
  const selectZoom = (i: number | null, seg?: { start: number; end: number }) => {
    setSelZoom(i)
    setSelFocus(null)
    setMode('zoom')
    jumpInto(seg)
  }

  // ----- segment mutations (geometry from the track, values from the panel) -----

  const setFocusSegments = (segments: FocusSegment[]) => {
    if (!lens) return
    save({ ...lens, focus: { ...lens.focus, enabled: true, segments } })
    toLive()
  }
  const setZoomSegments = (segments: ZoomSegment[]) => {
    if (!lens) return
    save({ ...lens, zoom: { ...lens.zoom, enabled: true, segments } })
    toLive()
  }

  const addFocusSegment = () => {
    if (!lens) return
    const range = newRange(lens.focus.segments, meta!.frame_count)
    if (!range) return
    const segments = [...lens.focus.segments, { start: range[0], end: range[1], depth: 0.5, label: '' }].sort(
      (a, b) => a.start - b.start,
    )
    setFocusSegments(segments)
    selectFocus(segments.findIndex((s) => s.start === range[0]), { start: range[0], end: range[1] })
  }

  const addZoomSegment = () => {
    if (!lens) return
    const range = newRange(lens.zoom.segments, meta!.frame_count)
    if (!range) return
    const segments = [
      ...lens.zoom.segments,
      { start: range[0], end: range[1], focal: '50mm', cx: 0.5, cy: 0.5 },
    ].sort((a, b) => a.start - b.start)
    setZoomSegments(segments)
    selectZoom(segments.findIndex((s) => s.start === range[0]), { start: range[0], end: range[1] })
  }

  const phrases = useMemo(
    () => (lens && mappings ? lensPhrases(lens, mappings, cameraMoveSet) : []),
    [lens, mappings, cameraMoveSet],
  )

  if (error && !meta) return <p className="py-16 text-center text-sm text-red-300">{error}</p>
  if (!meta || !lens || !mappings)
    return <p className="py-16 text-center text-sm text-slate-500">{t('common.loading')}</p>

  const imageSrc =
    source === 'rendered' && rendered
      ? frameUrl(shot, 'dof', frame)
      : source === 'live' && lensActive && previewUrl
        ? previewUrl
        : frameUrl(shot, 'frames', frame)

  const focusTrack: TrackSegment[] = lens.focus.segments.map((s) => ({
    start: s.start,
    end: s.end,
    label: (s.label || '').trim() || `${Math.round(s.depth * 100)}%`,
  }))
  const zoomTrack: TrackSegment[] = lens.zoom.segments.map((s) => ({
    start: s.start,
    end: s.end,
    label: s.focal,
  }))

  // Indicators are driven purely by the current frame and only shown on the
  // 'live' view — the 'original' view stays clean, with no added effects.
  const focusNow = source === 'live' && !followOn ? focalPlaneAt(lens, frame) : null
  const zoomNow = source === 'live' ? zoomAt(lens, frame) : null
  const cropFw = zoomNow ? 1 / zoomNow.scale : 1
  const crop = zoomNow
    ? {
        w: cropFw,
        h: cropFw,
        x: Math.max(0, Math.min(1 - cropFw, zoomNow.cx - cropFw / 2)),
        y: Math.max(0, Math.min(1 - cropFw, zoomNow.cy - cropFw / 2)),
      }
    : null

  const box = 'rounded-xl border border-night-700 bg-night-800 p-4'
  const smallSelect =
    'rounded-md border border-night-600 bg-night-900 px-1.5 py-1 text-[11px] text-slate-200 focus:border-accent focus:outline-none'
  const addBtn =
    'shrink-0 rounded-md border border-night-600 px-2 py-1 text-[11px] text-slate-400 transition hover:border-night-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30'

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
                ? followOn
                  ? t('lens.followActiveHint')
                  : hasDepth
                    ? t('lens.clickHintFocus')
                    : t('lens.noDepth')
                : t('lens.clickHintZoom')}
            </span>
          </div>

          <div className="rounded-xl border border-night-700 bg-night-900/60 p-3">
            <div
              className={`relative mx-auto w-fit ${
                (mode === 'focus' && hasDepth && !followOn) || mode === 'zoom' ? 'cursor-crosshair' : ''
              }`}
              onClick={handleImageClick}
            >
              <img src={imageSrc} alt="" draggable={false} className="block max-h-[56vh] rounded-lg" />
              {focusNow != null && (
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-cyan-300"
                  style={{ left: '50%', top: '8px' }}
                >
                  <span className="rounded bg-night-950/80 px-1.5 py-0.5 text-[10px] backdrop-blur">
                    {t('lens.focalPlane')} {Math.round(focusNow * 100)}% · {depthZone(t, focusNow)}
                  </span>
                </div>
              )}
              {/* Zoom center + crop-frame indicator */}
              {zoomNow && crop && (
                <>
                  <div
                    className="pointer-events-none absolute rounded-sm border-2 border-violet-300/80"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.w * 100}%`,
                      height: `${crop.h * 100}%`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${zoomNow.cx * 100}%`, top: `${zoomNow.cy * 100}%` }}
                  >
                    <div className="relative h-5 w-5">
                      <span className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-violet-300" />
                      <span className="absolute top-1/2 left-0 h-px w-5 -translate-y-1/2 bg-violet-300" />
                      <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-100 bg-violet-500/50" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Timeline: playhead + focus/zoom tracks share one [label | rail |
              control] grid so a frame lines up across all three rows. */}
          <div className="mt-2.5 flex flex-col gap-1.5">
            {/* Playhead */}
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-right font-mono text-[10px] text-slate-600">
                #{frame + 1}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, meta.frame_count - 1)}
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
                className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-night-700 accent-cyan-400"
              />
              <span className="w-16 shrink-0 text-right font-mono text-[10px] text-slate-500">
                {timecode(frame, meta.effective_fps)}
              </span>
            </div>
            {/* Focus track */}
            <div className="flex items-center gap-2">
              <span
                className={`w-12 shrink-0 text-[10px] font-medium ${
                  mode === 'focus' ? 'text-cyan-300' : 'text-cyan-300/40'
                }`}
              >
                {t('lens.laneFocus')}
              </span>
              <div className="min-w-0 flex-1">
                <SegmentTrack
                  segments={focusTrack}
                  frameCount={meta.frame_count}
                  accent="cyan"
                  selected={selFocus}
                  playhead={frame}
                  disabled={followOn}
                  onSelect={(i) => selectFocus(i, i != null ? lens.focus.segments[i] : undefined)}
                  onGeometry={(geo) =>
                    setFocusSegments(
                      lens.focus.segments.map((s, i) => ({ ...s, start: geo[i].start, end: geo[i].end })),
                    )
                  }
                  onDraw={(lo, hi) => {
                    if (lens.focus.segments.length >= SEGMENT_CAP) return
                    const segments = [
                      ...lens.focus.segments,
                      { start: lo, end: hi, depth: 0.5, label: '' },
                    ].sort((a, b) => a.start - b.start)
                    setFocusSegments(segments)
                    selectFocus(segments.findIndex((s) => s.start === lo), { start: lo, end: hi })
                  }}
                />
              </div>
              <div className="flex w-16 shrink-0 justify-end">
                <button
                  className={addBtn}
                  title={t('lens.addSegment')}
                  disabled={followOn || lens.focus.segments.length >= SEGMENT_CAP}
                  onClick={addFocusSegment}
                >
                  +
                </button>
              </div>
            </div>
            {/* Zoom track */}
            <div className="flex items-center gap-2">
              <span
                className={`w-12 shrink-0 text-[10px] font-medium ${
                  mode === 'zoom' ? 'text-violet-300' : 'text-violet-300/40'
                }`}
              >
                {t('lens.laneZoom')}
              </span>
              <div className="min-w-0 flex-1">
                <SegmentTrack
                  segments={zoomTrack}
                  frameCount={meta.frame_count}
                  accent="violet"
                  selected={selZoom}
                  playhead={frame}
                  onSelect={(i) => selectZoom(i, i != null ? lens.zoom.segments[i] : undefined)}
                  onGeometry={(geo) =>
                    setZoomSegments(
                      lens.zoom.segments.map((s, i) => ({ ...s, start: geo[i].start, end: geo[i].end })),
                    )
                  }
                  onDraw={(lo, hi) => {
                    if (lens.zoom.segments.length >= SEGMENT_CAP) return
                    const segments = [
                      ...lens.zoom.segments,
                      { start: lo, end: hi, focal: '50mm', cx: 0.5, cy: 0.5 },
                    ].sort((a, b) => a.start - b.start)
                    setZoomSegments(segments)
                    selectZoom(segments.findIndex((s) => s.start === lo), { start: lo, end: hi })
                  }}
                />
              </div>
              <div className="flex w-16 shrink-0 justify-end">
                <button
                  className={addBtn}
                  title={t('lens.addSegment')}
                  disabled={lens.zoom.segments.length >= SEGMENT_CAP}
                  onClick={addZoomSegment}
                >
                  +
                </button>
              </div>
            </div>
            <p className="pl-14 text-[10px] text-slate-600">{t('lens.trackHint')}</p>
          </div>
        </div>

        {/* Panel */}
        <aside className="flex w-72 shrink-0 flex-col gap-3">
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
            {/* Follow performer: exclusive with segments */}
            <label
              className={`mt-2 flex items-center justify-between rounded-md border px-2 py-1.5 ${
                hasPose && hasDepth ? 'cursor-pointer border-night-700' : 'border-night-800 opacity-50'
              }`}
            >
              <span className="text-[11px] text-slate-300">{t('lens.followSubject')}</span>
              <input
                type="checkbox"
                disabled={!hasPose || !hasDepth}
                checked={lens.focus.follow_subject}
                onChange={(e) => {
                  save({
                    ...lens,
                    focus: { ...lens.focus, enabled: true, follow_subject: e.target.checked },
                  })
                  if (e.target.checked) toLive()
                }}
                className="accent-cyan-400"
              />
            </label>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
              {hasPose && hasDepth ? t('lens.followSubjectHint') : t('lens.followSubjectNeed')}
            </p>

            {/* Focus segment list */}
            <div className={`mt-2 flex flex-col gap-1.5 ${followOn ? 'pointer-events-none opacity-40' : ''}`}>
              {lens.focus.segments.length === 0 && (
                <p className="text-[11px] text-slate-600">{t('lens.noFocusSegs')}</p>
              )}
              {lens.focus.segments.map((seg, i) => (
                <div
                  key={i}
                  onClick={() => selectFocus(i, seg)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 ${
                    selFocus === i
                      ? 'border-cyan-400 bg-cyan-950/40 ring-1 ring-cyan-500/40'
                      : 'border-night-700'
                  }`}
                >
                  <span className="font-mono text-[10px] text-slate-500">
                    {seg.start + 1}–{seg.end + 1}
                  </span>
                  <span className="text-[10px] text-cyan-300">{Math.round(seg.depth * 100)}%</span>
                  <input
                    value={seg.label}
                    placeholder={t('lens.labelPlaceholder')}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setFocusSegments(
                        lens.focus.segments.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)),
                      )
                    }
                    className="min-w-0 flex-1 rounded border border-night-700 bg-night-900 px-1.5 py-0.5 text-[10px] text-slate-300 placeholder:text-slate-700 focus:border-accent focus:outline-none"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setFocusSegments(lens.focus.segments.filter((_, j) => j !== i))
                      setSelFocus(null)
                    }}
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
                  onChange={(e) => {
                    save({ ...lens, focus: { ...lens.focus, max_blur: Number(e.target.value) } })
                    toLive()
                  }}
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
                  onChange={(e) => {
                    save({ ...lens, focus: { ...lens.focus, falloff: Number(e.target.value) / 100 } })
                    toLive()
                  }}
                  className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-night-700 accent-cyan-400"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                {t('lens.easing')}
                <select
                  className={smallSelect}
                  value={lens.focus.easing}
                  onChange={(e) => {
                    save({ ...lens, focus: { ...lens.focus, easing: e.target.value as 'linear' | 'smooth' } })
                    toLive()
                  }}
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
              {lens.zoom.segments.length === 0 && (
                <p className="text-[11px] text-slate-600">{t('lens.noZoomSegs')}</p>
              )}
              {lens.zoom.segments.map((seg, i) => (
                <div
                  key={i}
                  onClick={() => selectZoom(i, seg)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 ${
                    selZoom === i
                      ? 'border-violet-400 bg-violet-950/40 ring-1 ring-violet-500/40'
                      : 'border-night-700'
                  }`}
                >
                  <span className="font-mono text-[10px] text-slate-500">
                    {seg.start + 1}–{seg.end + 1}
                  </span>
                  <select
                    className={smallSelect}
                    onClick={(e) => e.stopPropagation()}
                    value={seg.focal}
                    onChange={(e) =>
                      setZoomSegments(
                        lens.zoom.segments.map((s, j) => (j === i ? { ...s, focal: e.target.value } : s)),
                      )
                    }
                  >
                    {mappings.focal_lengths.map((o) => (
                      <option key={o.key} value={o.key}>
                        {zh ? o.label_zh : o.label_en}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setZoomSegments(lens.zoom.segments.filter((_, j) => j !== i))
                      setSelZoom(null)
                    }}
                    className="ml-auto text-slate-600 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[10px] leading-relaxed text-slate-600">{t('lens.zoomHint')}</p>
            {lens.zoom.segments.length < 2 && (
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
            disabled={
              !hasDepth ||
              !lens.focus.enabled ||
              (lens.focus.segments.length === 0 && !(lens.focus.follow_subject && hasPose))
            }
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
