import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../common/Modal'
import Button from '../common/Button'
import type { Film } from '../../api/types'

interface Props {
  open: boolean
  film?: Film | null // present = edit mode
  onClose: () => void
  onSubmit: (values: { name: string; description: string }) => Promise<void>
}

export default function FilmFormModal({ open, film, onClose, onSubmit }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(film?.name ?? '')
      setDescription(film?.description ?? '')
    }
  }, [open, film])

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), description })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={film ? t('films.editFilm') : t('films.newFilm')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          {t('films.nameLabel')}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            placeholder={t('films.namePlaceholder')}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          {t('films.descLabel')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="resize-none rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            placeholder={t('films.descPlaceholder')}
          />
        </label>
      </div>
    </Modal>
  )
}
