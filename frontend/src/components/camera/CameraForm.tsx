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

      <div className="flex flex-col gap-3 border-t border-night-700/60 pt-4">
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
      </div>
    </div>
  )
}
