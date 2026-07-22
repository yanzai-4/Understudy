import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Shot } from '../../api/types'
import {
  cancelTask,
  getHardware,
  getShot,
  listExtractors,
  startExtraction,
} from '../../api/endpoints'
import { useTaskPolling } from '../../hooks/useTaskPolling'
import { formatEstimate } from '../../lib/format'
import Button from '../common/Button'

const CHANNEL_ORDER = ['pose', 'depth', 'layout']

interface Props {
  shot: Shot
  onShotUpdated: (shot: Shot) => void
  onNext: () => void
}

export default function StepExtract({ shot, onShotUpdated, onNext }: Props) {
  const { t, i18n } = useTranslation()
  const [available, setAvailable] = useState<string[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [strideMode, setStrideMode] = useState<'auto' | number>('auto')
  const [maxSize, setMaxSize] = useState(768)
  const [recommendedSize, setRecommendedSize] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listExtractors()
      .then((list) => {
        const names = CHANNEL_ORDER.filter((n) => list.some((e) => e.name === n))
        setAvailable(names)
        setChannels(names)
      })
      .catch(console.error)
    // processing resolution auto-defaults to the hardware-recommended value
    getHardware()
      .then((h) => {
        setRecommendedSize(h.recommended.default_max_size)
        setMaxSize(h.recommended.default_max_size)
      })
      .catch(console.error)
  }, [])

  const task = useTaskPolling(taskId, async (snapshot) => {
    if (snapshot.status === 'done') {
      onShotUpdated(await getShot(shot.id))
    }
  })

  const running = task !== null && ['queued', 'running'].includes(task.status)

  const start = async () => {
    setError('')
    try {
      const { task_id } = await startExtraction(shot.id, {
        channels,
        stride: strideMode,
        max_size: maxSize,
      })
      setTaskId(task_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const frameCount = shot.video_frame_count ?? 0
  const effectiveStride =
    strideMode === 'auto' ? Math.max(1, Math.ceil(frameCount / 300)) : strideMode
  const outFrames = Math.ceil(frameCount / Math.max(1, effectiveStride))
  // Measured CPU throughput on a 14-core laptop: ~4 s/frame with pose+depth.
  const heavy = ['pose', 'depth', 'layout'].some((c) => channels.includes(c))
  const estimate = heavy ? Math.round(outFrames * 4) : Math.round(outFrames * 0.05)

  const alreadyExtracted = shot.status === 'extracted' || shot.status === 'exported'

  const box = 'rounded-xl border border-night-700 bg-night-800 p-5'
  const select =
    'rounded-lg border border-night-600 bg-night-900 px-2.5 py-1.5 text-sm text-slate-200 focus:border-accent focus:outline-none'

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Options */}
      <div className={box}>
        <h3 className="mb-3 text-sm font-medium text-slate-200">{t('extract.channels')}</h3>
        <div className="flex gap-3">
          {CHANNEL_ORDER.map((name) => {
            const enabled = available.includes(name)
            const checked = channels.includes(name)
            return (
              <label
                key={name}
                className={`flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm transition ${
                  !enabled
                    ? 'cursor-not-allowed border-night-700 text-slate-700'
                    : checked
                      ? 'cursor-pointer border-accent/60 bg-blue-950/40 text-cyan-200'
                      : 'cursor-pointer border-night-600 text-slate-400 hover:border-night-500'
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  disabled={!enabled || running}
                  checked={checked}
                  onChange={() =>
                    setChannels((cur) =>
                      checked ? cur.filter((c) => c !== name) : [...cur, name],
                    )
                  }
                />
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                    checked ? 'border-cyan-400 bg-accent text-white' : 'border-night-500'
                  }`}
                >
                  {checked && '✓'}
                </span>
                {t(`extract.channel.${name}`)}
                {!enabled && <span className="text-[10px]">({t('extract.unavailable')})</span>}
              </label>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-5">
          <label className="flex flex-col gap-1.5 text-xs text-slate-400">
            {t('extract.stride')}
            <select
              className={select}
              disabled={running}
              value={strideMode === 'auto' ? 'auto' : String(strideMode)}
              onChange={(e) =>
                setStrideMode(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
              }
            >
              <option value="auto">{t('extract.strideAuto', { n: effectiveStride })}</option>
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {t('extract.strideN', { n })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-slate-400">
            {t('extract.maxSize')}
            <select
              className={select}
              disabled={running}
              value={maxSize}
              onChange={(e) => setMaxSize(Number(e.target.value))}
            >
              {[512, 768, 960].map((n) => (
                <option key={n} value={n}>
                  {n}px{n === recommendedSize ? t('extract.recommended') : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto text-right text-xs text-slate-500">
            <div>{t('extract.willOutput', { frames: outFrames })}</div>
            <div className="text-amber-400">
              {t('extract.estimate', { time: formatEstimate(estimate, i18n.language) })}
            </div>
          </div>
        </div>
      </div>

      {/* Progress / actions */}
      <div className={box}>
        {running && task ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                {task.stage.startsWith('extract')
                  ? t('extract.stageExtract', { detail: task.stage.replace('extract ', '') })
                  : t(`extract.stage.${task.stage}`, task.stage)}
              </span>
              <span>{Math.round(task.progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-night-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-glow transition-all duration-300"
                style={{ width: `${Math.round(task.progress * 100)}%` }}
              />
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => taskId && cancelTask(taskId)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {task?.status === 'done' || (alreadyExtracted && !task) ? (
              <>
                <span className="text-sm text-emerald-300">
                  ✓{' '}
                  {t('extract.done', {
                    frames: shot.extract_frame_count ?? '?',
                  })}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" onClick={start} disabled={channels.length === 0}>
                    {t('extract.rerun')}
                  </Button>
                  <Button onClick={onNext}>{t('common.next')} →</Button>
                </div>
              </>
            ) : (
              <>
                {task?.status === 'error' && (
                  <span className="text-xs text-red-300">{task.error}</span>
                )}
                {task?.status === 'cancelled' && (
                  <span className="text-xs text-amber-300">{t('extract.cancelled')}</span>
                )}
                {error && <span className="text-xs text-red-300">{error}</span>}
                <div className="ml-auto">
                  <Button onClick={start} disabled={channels.length === 0}>
                    {task?.status === 'error' ? t('common.retry') : t('extract.start')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
