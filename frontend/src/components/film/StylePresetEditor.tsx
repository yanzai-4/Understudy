import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Film, PromptMappings } from '../../api/types'
import { getPromptMappings, updateFilm } from '../../api/endpoints'
import Modal from '../common/Modal'
import Button from '../common/Button'
import OptionSelect from '../camera/OptionSelect'

interface Props {
  open: boolean
  film: Film
  onClose: () => void
  onSaved: (film: Film) => void
}

/** Film-level default cinematography: new shots inherit these as initial values. */
export default function StylePresetEditor({ open, film, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const [mappings, setMappings] = useState<PromptMappings | null>(null)
  const [preset, setPreset] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      getPromptMappings().then(setMappings).catch(console.error)
      setPreset(
        Object.fromEntries(
          Object.entries(film.default_camera_params ?? {}).filter(([, v]) => v != null),
        ) as Record<string, string>,
      )
    }
  }, [open, film])

  const save = async () => {
    setBusy(true)
    try {
      onSaved(await updateFilm(film.id, { default_camera_params: preset }))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('preset.title')}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={busy || !mappings}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-500">{t('preset.hint')}</p>
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-accent/40 bg-blue-950/25 px-3 py-2 text-[11px] leading-relaxed text-cyan-300">
        <svg className="mt-0.5 shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5m0-8h.01" />
        </svg>
        {t('preset.perFilm')}
      </div>
      {mappings ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {[...mappings.dimensions]
            .sort((a, b) => a.order - b.order)
            .map((dim) => (
              <OptionSelect
                key={dim.key}
                dimension={dim}
                value={preset[dim.key] ?? null}
                onChange={(v) => {
                  setPreset((cur) => {
                    const next = { ...cur }
                    if (v == null) delete next[dim.key]
                    else next[dim.key] = v
                    return next
                  })
                }}
              />
            ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">{t('common.loading')}</p>
      )}
    </Modal>
  )
}
