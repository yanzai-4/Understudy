import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BackgroundEdit, ExtractionMeta, Shot } from '../../api/types'
import {
  generatePrompt,
  getExtraction,
  getShot,
  listBackgroundEdits,
  listExports,
  startExport,
  type ExportRecordOut,
} from '../../api/endpoints'
import { useTaskPolling } from '../../hooks/useTaskPolling'
import { formatBytes, relativeTime } from '../../lib/format'
import Button from '../common/Button'

interface Props {
  shot: Shot
  onShotUpdated: (shot: Shot) => void
}

export default function StepExport({ shot, onShotUpdated }: Props) {
  const { t } = useTranslation()
  const [meta, setMeta] = useState<ExtractionMeta | null>(null)
  const [edits, setEdits] = useState<BackgroundEdit[]>([])
  const [history, setHistory] = useState<ExportRecordOut[]>([])
  const [includeSource, setIncludeSource] = useState(false)
  const [includeVideos, setIncludeVideos] = useState(true)
  const [channels, setChannels] = useState<string[]>([])
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [lastExportId, setLastExportId] = useState<number | null>(null)

  useEffect(() => {
    getExtraction(shot.id)
      .then((m) => {
        setMeta(m)
        setChannels(m.channels)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    listBackgroundEdits(shot.id).then(setEdits).catch(console.error)
    listExports(shot.id).then(setHistory).catch(console.error)
  }, [shot.id])

  const task = useTaskPolling(taskId, async (snapshot) => {
    if (snapshot.status === 'done') {
      setLastExportId((snapshot.result?.export_id as number) ?? null)
      onShotUpdated(await getShot(shot.id))
      setHistory(await listExports(shot.id))
    }
  })
  const running = task !== null && ['queued', 'running'].includes(task.status)

  const doExport = async () => {
    setError('')
    try {
      await generatePrompt(shot.id) // freeze the prompt used by this export
      const { task_id } = await startExport(shot.id, {
        source: includeSource,
        channels,
        masks: true,
        control_videos: includeVideos,
      })
      setTaskId(task_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const box = 'rounded-xl border border-night-700 bg-night-800 p-5'
  const checkbox = (checked: boolean, disabled = false) =>
    `flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
      disabled ? 'border-night-700' : checked ? 'border-cyan-400 bg-accent text-white' : 'border-night-500'
    }`

  if (!meta && !error)
    return <p className="py-16 text-center text-sm text-slate-500">{t('common.loading')}</p>

  const latest = history.find((h) => h.id === lastExportId) ?? history[0]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {meta && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-700/40 bg-emerald-950/25 px-4 py-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <div className="text-xs leading-relaxed">
            <span className="font-medium text-emerald-300">{t('export.readyTitle')}</span>
            <span className="ml-1.5 text-emerald-400/80">
              {t('export.readyDetail', {
                channels: meta.channels.map((c) => t(`extract.channel.${c}`)).join(' / '),
                frames: meta.frame_count,
              })}
            </span>
          </div>
        </div>
      )}
      {meta && (
        <div className={box}>
          <h3 className="mb-3 text-sm font-medium text-slate-200">{t('export.contents')}</h3>
          <div className="flex flex-col gap-2.5 text-sm text-slate-300">
            {meta.channels.map((ch) => {
              const on = channels.includes(ch)
              return (
                <label key={ch} className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={on}
                    disabled={running}
                    onChange={() =>
                      setChannels((cur) => (on ? cur.filter((c) => c !== ch) : [...cur, ch]))
                    }
                  />
                  <span className={checkbox(on)}>{on && '✓'}</span>
                  {t('export.channelSeq', { ch: t(`extract.channel.${ch}`) })}
                </label>
              )
            })}
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="hidden"
                checked={includeVideos}
                disabled={running}
                onChange={() => setIncludeVideos((v) => !v)}
              />
              <span className={checkbox(includeVideos)}>{includeVideos && '✓'}</span>
              {t('export.controlVideos')}
            </label>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="hidden"
                checked={includeSource}
                disabled={running}
                onChange={() => setIncludeSource((v) => !v)}
              />
              <span className={checkbox(includeSource)}>{includeSource && '✓'}</span>
              {t('export.sourceVideo')}
            </label>
            <div className="flex items-center gap-2.5 text-slate-500">
              <span className={checkbox(edits.length > 0, true)}>{edits.length > 0 && '✓'}</span>
              {t('export.masksAuto', { count: edits.length })}
            </div>
            <div className="flex items-center gap-2.5 text-slate-500">
              <span className={checkbox(true, true)}>✓</span>
              {t('export.always')}
            </div>
          </div>
        </div>
      )}

      <div className={box}>
        {running && task ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{task.stage || t('export.working')}</span>
              <span>{Math.round(task.progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-night-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-glow transition-all duration-300"
                style={{ width: `${Math.round(task.progress * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {task?.status === 'done' && latest ? (
              <>
                <span className="text-sm text-emerald-300">✓ {t('export.done')}</span>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" onClick={doExport} disabled={channels.length === 0}>
                    {t('export.again')}
                  </Button>
                  <a href={latest.download_url} download>
                    <Button>{t('common.download')} · {formatBytes(latest.size_bytes)}</Button>
                  </a>
                </div>
              </>
            ) : (
              <>
                {(task?.status === 'error' || error) && (
                  <span className="text-xs text-red-300">{task?.error ?? error}</span>
                )}
                <div className="ml-auto">
                  <Button onClick={doExport} disabled={channels.length === 0 || !meta}>
                    {t('export.start')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className={box}>
          <h3 className="mb-3 text-sm font-medium text-slate-200">{t('export.history')}</h3>
          <div className="flex flex-col gap-1.5">
            {history.map((rec) => (
              <div
                key={rec.id}
                className="flex items-center gap-3 rounded-lg border border-night-700 bg-night-900 px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-slate-300">{rec.zip_name}</span>
                <span className="shrink-0 text-slate-600">{formatBytes(rec.size_bytes)}</span>
                <span className="shrink-0 text-slate-600">{relativeTime(rec.created_at)}</span>
                <a
                  href={rec.download_url}
                  download
                  className="shrink-0 rounded border border-night-600 px-2 py-0.5 text-slate-400 transition hover:border-accent hover:text-cyan-300"
                >
                  {t('common.download')}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
