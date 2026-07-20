import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BackgroundEdit, ExtractionMeta, Shot } from '../../api/types'
import {
  createBackgroundEdit,
  deleteBackgroundEdit,
  getExtraction,
  listBackgroundEdits,
  updateBackgroundEdit,
} from '../../api/endpoints'
import FramePlayer from '../preview/FramePlayer'
import BoxDrawLayer, { type NormBox } from '../preview/BoxDrawLayer'
import BackgroundEditModal, { type EditFormValues } from '../preview/BackgroundEditModal'
import ConfirmDialog from '../common/ConfirmDialog'
import HintBar from '../common/HintBar'
import Button from '../common/Button'

const TYPE_DOT: Record<string, string> = {
  remove: 'bg-red-400',
  add: 'bg-emerald-400',
  replace: 'bg-blue-400',
}

interface Props {
  shot: Shot
  onNext: () => void
}

export default function StepPreview({ shot, onNext }: Props) {
  const { t } = useTranslation()
  const [meta, setMeta] = useState<ExtractionMeta | null>(null)
  const [error, setError] = useState('')
  const [edits, setEdits] = useState<BackgroundEdit[]>([])
  const [annotating, setAnnotating] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pendingBox, setPendingBox] = useState<NormBox | null>(null) // freshly drawn, awaiting form
  const [editingEdit, setEditingEdit] = useState<BackgroundEdit | null>(null)
  const [deletingEdit, setDeletingEdit] = useState<BackgroundEdit | null>(null)

  useEffect(() => {
    getExtraction(shot.id)
      .then(setMeta)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    listBackgroundEdits(shot.id).then(setEdits).catch(console.error)
  }, [shot.id])

  const reload = async () => setEdits(await listBackgroundEdits(shot.id))

  const handleModalSubmit = async (values: EditFormValues) => {
    if (editingEdit) {
      await updateBackgroundEdit(editingEdit.id, values)
    } else if (pendingBox) {
      await createBackgroundEdit(shot.id, { ...values, ...pendingBox })
    }
    setPendingBox(null)
    setEditingEdit(null)
    await reload()
  }

  const handleBoxChange = async (id: number, box: NormBox) => {
    await updateBackgroundEdit(id, box)
    await reload()
  }

  const handleDelete = async () => {
    if (!deletingEdit) return
    await deleteBackgroundEdit(deletingEdit.id)
    setDeletingEdit(null)
    setSelectedId(null)
    await reload()
  }

  if (error) return <p className="py-16 text-center text-sm text-red-300">{error}</p>
  if (!meta) return <p className="py-16 text-center text-sm text-slate-500">{t('common.loading')}</p>

  return (
    <div className="flex flex-col gap-4">
      <HintBar text={t('preview.hintBar')} />
      <div className="flex gap-4">
        {/* Player */}
        <div className="min-w-0 flex-1">
          <FramePlayer
            shot={shot}
            meta={meta}
            overlayExtras={
              <BoxDrawLayer
                boxes={edits}
                selectedId={selectedId}
                drawMode={annotating}
                onSelect={setSelectedId}
                onDrawn={(box) => {
                  setEditingEdit(null)
                  setPendingBox(box)
                }}
                onBoxChange={handleBoxChange}
              />
            }
          />
        </div>

        {/* Annotation sidebar */}
        <aside className="flex w-64 shrink-0 flex-col gap-2.5">
          <button
            onClick={() => setAnnotating((v) => !v)}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
              annotating
                ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-300 shadow-lg shadow-cyan-950/40'
                : 'border-accent/60 bg-accent/10 text-cyan-300 hover:border-accent hover:bg-accent/20'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3" />
              <path d="M9 9h6v6H9z" />
            </svg>
            {annotating ? t('bgEdit.annotatingOn') : t('bgEdit.annotate')}
          </button>
          {annotating && <p className="text-[11px] leading-relaxed text-slate-600">{t('bgEdit.hint')}</p>}

          <div className="flex flex-col gap-1.5 overflow-y-auto">
            {edits.length === 0 && (
              <p className="py-4 text-center text-[11px] text-slate-600">{t('bgEdit.empty')}</p>
            )}
            {edits.map((edit) => (
              <div
                key={edit.id}
                onClick={() => setSelectedId(edit.id === selectedId ? null : edit.id)}
                className={`cursor-pointer rounded-lg border px-3 py-2 transition ${
                  selectedId === edit.id
                    ? 'border-cyan-500/50 bg-night-800'
                    : 'border-night-700 bg-night-850 hover:border-night-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[edit.edit_type]}`} />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{edit.label}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingBox(null)
                      setEditingEdit(edit)
                    }}
                    className="text-slate-600 hover:text-slate-300"
                    title={t('common.edit')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingEdit(edit)
                    }}
                    className="text-slate-600 hover:text-red-300"
                    title={t('common.delete')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  </button>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 pl-4 text-[10px] text-slate-500">
                  <span>{t(`bgEdit.type.${edit.edit_type}`)}</span>
                  {edit.description && <span className="truncate">· {edit.description}</span>}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {meta.output_size[0]}×{meta.output_size[1]} · {meta.frame_count}{' '}
          {t('preview.framesAt', { fps: meta.effective_fps.toFixed(1) })}
        </span>
        <Button onClick={onNext}>{t('common.next')} →</Button>
      </div>

      <BackgroundEditModal
        open={pendingBox !== null || editingEdit !== null}
        edit={editingEdit}
        onClose={() => {
          setPendingBox(null)
          setEditingEdit(null)
        }}
        onSubmit={handleModalSubmit}
      />
      <ConfirmDialog
        open={deletingEdit !== null}
        title={t('bgEdit.deleteTitle')}
        message={t('bgEdit.deleteMessage', { name: deletingEdit?.label ?? '' })}
        onConfirm={handleDelete}
        onCancel={() => setDeletingEdit(null)}
      />
    </div>
  )
}
