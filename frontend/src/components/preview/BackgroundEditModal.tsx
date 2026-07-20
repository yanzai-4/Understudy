import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BackgroundEdit, EditType } from '../../api/types'
import Modal from '../common/Modal'
import Button from '../common/Button'

export interface EditFormValues {
  label: string
  edit_type: EditType
  description: string
}

const TYPES: { value: EditType; chip: string }[] = [
  { value: 'remove', chip: 'border-red-500/60 bg-red-950/40 text-red-300' },
  { value: 'add', chip: 'border-emerald-500/60 bg-emerald-950/40 text-emerald-300' },
  { value: 'replace', chip: 'border-blue-500/60 bg-blue-950/40 text-blue-300' },
]

interface Props {
  open: boolean
  edit?: BackgroundEdit | null // present = editing an existing annotation
  onClose: () => void
  onSubmit: (values: EditFormValues) => Promise<void>
}

export default function BackgroundEditModal({ open, edit, onClose, onSubmit }: Props) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [editType, setEditType] = useState<EditType>('remove')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setLabel(edit?.label ?? '')
      setEditType(edit?.edit_type ?? 'remove')
      setDescription(edit?.description ?? '')
    }
  }, [open, edit])

  const submit = async () => {
    if (!label.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit({ label: label.trim(), edit_type: editType, description })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? t('bgEdit.editTitle') : t('bgEdit.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!label.trim() || busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          {t('bgEdit.labelLabel')}
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            placeholder={t('bgEdit.labelPlaceholder')}
          />
        </label>
        <div className="flex flex-col gap-1.5 text-xs text-slate-400">
          {t('bgEdit.typeLabel')}
          <div className="flex gap-2">
            {TYPES.map(({ value, chip }) => (
              <button
                key={value}
                type="button"
                onClick={() => setEditType(value)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  editType === value ? chip : 'border-night-600 text-slate-500 hover:border-night-500'
                }`}
              >
                {t(`bgEdit.type.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          {t('bgEdit.descLabel')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="resize-none rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            placeholder={t('bgEdit.descPlaceholder')}
          />
        </label>
      </div>
    </Modal>
  )
}
