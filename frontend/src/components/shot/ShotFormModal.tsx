import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../common/Modal'
import Button from '../common/Button'
import TagInput from '../common/TagInput'
import type { Shot } from '../../api/types'

export interface ShotFormValues {
  name: string
  scene_no: number | null
  tags: string[]
  notes: string
}

interface Props {
  open: boolean
  shot?: Shot | null // present = edit mode
  tagSuggestions: string[]
  onClose: () => void
  onSubmit: (values: ShotFormValues) => Promise<void>
}

export default function ShotFormModal({ open, shot, tagSuggestions, onClose, onSubmit }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [sceneNo, setSceneNo] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(shot?.name ?? '')
      setSceneNo(shot?.scene_no != null ? String(shot.scene_no) : '')
      setTags(shot?.tags ?? [])
      setNotes(shot?.notes ?? '')
    }
  }, [open, shot])

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit({
        name: name.trim(),
        scene_no: sceneNo === '' ? null : Math.max(0, parseInt(sceneNo, 10) || 0),
        tags,
        notes,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const label = 'flex flex-col gap-1.5 text-xs text-slate-400'
  const input =
    'rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shot ? t('shots.editShot') : t('shots.newShot')}
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
        <label className={label}>
          {t('shots.nameLabel')}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
            placeholder={t('shots.namePlaceholder')}
          />
        </label>
        <label className={label}>
          {t('shots.sceneLabel')}
          <input
            type="number"
            min={0}
            value={sceneNo}
            onChange={(e) => setSceneNo(e.target.value)}
            className={input}
            placeholder={t('shots.scenePlaceholder')}
          />
        </label>
        <div className={label}>
          {t('shots.tagsLabel')}
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={tagSuggestions}
            placeholder={t('shots.tagsPlaceholder')}
          />
        </div>
        <label className={label}>
          {t('shots.notesLabel')}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={`${input} resize-none`}
            placeholder={t('shots.notesPlaceholder')}
          />
        </label>
      </div>
    </Modal>
  )
}
