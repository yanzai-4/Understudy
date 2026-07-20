import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Shot } from '../../api/types'
import { uploadVideo } from '../../api/upload'
import { formatDuration } from '../../lib/format'
import Button from '../common/Button'
import ConfirmDialog from '../common/ConfirmDialog'

interface Props {
  shot: Shot
  onShotUpdated: (shot: Shot) => void
  /** Called after a *replacement* upload succeeds (there was already a video). */
  onVideoReplaced: (shot: Shot) => void
  onNext: () => void
}

export default function StepUpload({ shot, onShotUpdated, onVideoReplaced, onNext }: Props) {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null) // awaiting replace confirmation
  const inputRef = useRef<HTMLInputElement>(null)

  const hasVideo = shot.video_frame_count != null

  const doUpload = async (file: File) => {
    setError('')
    setProgress(0)
    const wasReplace = hasVideo
    try {
      const updated = await uploadVideo(shot.id, file, setProgress)
      if (wasReplace) onVideoReplaced(updated)
      else onShotUpdated(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  // A new file goes through a confirm gate only when it would replace an
  // existing video (and wipe its extraction results).
  const receiveFile = (file: File) => {
    if (hasVideo) setPendingFile(file)
    else doUpload(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) receiveFile(file)
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Re-upload warning */}
      {hasVideo && progress === null && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-300">
          <svg className="mt-0.5 shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          {t('upload.replaceWarning')}
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => progress === null && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 transition ${
          dragOver
            ? 'border-accent bg-blue-950/30'
            : 'border-night-600 bg-night-900/50 hover:border-night-500'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mp4,.mov,.avi,.mkv,.webm,.m4v"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) receiveFile(file)
            e.target.value = ''
          }}
        />
        {progress !== null ? (
          <>
            <div className="h-1.5 w-64 overflow-hidden rounded-full bg-night-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-glow transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              {t('upload.uploading', { pct: Math.round(progress * 100) })}
            </p>
          </>
        ) : (
          <>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-slate-500">
              <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <p className="text-sm text-slate-300">
              {hasVideo ? t('upload.replaceHint') : t('upload.dropHint')}
            </p>
            <p className="text-[11px] text-slate-600">{t('upload.formats')}</p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Video info card */}
      {hasVideo && (
        <div className="mt-5 flex gap-4 rounded-xl border border-night-700 bg-night-800 p-4">
          <div className="w-44 shrink-0 overflow-hidden rounded-lg bg-night-900">
            {shot.thumbnail_url && (
              <img
                src={`${shot.thumbnail_url}?v=${Date.parse(shot.updated_at)}`}
                alt=""
                className="aspect-video h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex flex-col justify-center gap-1 text-xs text-slate-400">
            <div className="mb-0.5 max-w-xs truncate text-sm font-medium text-slate-200">
              {shot.source_filename}
            </div>
            <div>
              {t('upload.resolution')}: {shot.video_width}×{shot.video_height}
            </div>
            <div>
              {t('upload.fps')}: {shot.video_fps?.toFixed(2)} · {t('upload.frames')}:{' '}
              {shot.video_frame_count}
            </div>
            <div>
              {t('upload.duration')}: {formatDuration(shot.video_duration_sec)}
            </div>
          </div>
          <div className="ml-auto self-center">
            <Button onClick={onNext}>{t('common.next')} →</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingFile !== null}
        title={t('upload.replaceTitle')}
        message={t('upload.replaceConfirm')}
        confirmLabel={t('upload.replaceConfirmBtn')}
        onConfirm={() => {
          const file = pendingFile
          setPendingFile(null)
          if (file) doUpload(file)
        }}
        onCancel={() => setPendingFile(null)}
      />
    </div>
  )
}
