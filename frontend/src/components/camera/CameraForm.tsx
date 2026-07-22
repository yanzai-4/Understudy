import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CameraParamsValues, PromptMappings } from '../../api/types'
import OptionSelect from './OptionSelect'

interface Props {
  mappings: PromptMappings
  values: CameraParamsValues
  onChange: (values: CameraParamsValues) => void
  preset?: Record<string, string> | null
}

const textarea =
  'resize-none rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-accent focus:outline-none'

function Fold({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-night-700/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-300 hover:text-slate-100"
      >
        {title}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>}
    </div>
  )
}

export default function CameraForm({ mappings, values, onChange, preset }: Props) {
  const { t } = useTranslation()
  const dims = [...mappings.dimensions].sort((a, b) => a.order - b.order)

  const set = (key: string, value: string | null) => onChange({ ...values, [key]: value })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {dims.map((dim) => (
          <OptionSelect
            key={dim.key}
            dimension={dim}
            value={(values[dim.key as keyof CameraParamsValues] as string | null) ?? null}
            onChange={(v) => set(dim.key, v)}
            presetValue={preset?.[dim.key] ?? null}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-night-700/60 pt-4">
        <Fold title={t('camera.descGroup')} defaultOpen>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('camera.subjectDesc')}
            <textarea
              rows={2}
              className={textarea}
              value={values.subject_desc}
              onChange={(e) => onChange({ ...values, subject_desc: e.target.value })}
              placeholder={t('camera.subjectPlaceholder')}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('camera.sceneDesc')}
            <textarea
              rows={2}
              className={textarea}
              value={values.scene_desc}
              onChange={(e) => onChange({ ...values, scene_desc: e.target.value })}
              placeholder={t('camera.scenePlaceholder')}
            />
          </label>
        </Fold>

        <Fold title={t('camera.termsGroup')}>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              {t('camera.customPositive')}
              <textarea
                rows={2}
                className={textarea}
                value={values.custom_positive}
                onChange={(e) => onChange({ ...values, custom_positive: e.target.value })}
                placeholder={t('camera.customPositivePlaceholder')}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              {t('camera.customNegative')}
              <textarea
                rows={2}
                className={textarea}
                value={values.custom_negative}
                onChange={(e) => onChange({ ...values, custom_negative: e.target.value })}
                placeholder={t('camera.customNegativePlaceholder')}
              />
            </label>
          </div>
        </Fold>
      </div>
    </div>
  )
}
