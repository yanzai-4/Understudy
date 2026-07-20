import { useTranslation } from 'react-i18next'
import type { MappingDimension } from '../../api/types'

interface Props {
  dimension: MappingDimension
  value: string | null
  onChange: (value: string | null) => void
  presetValue?: string | null // film style preset for this dimension
}

export default function OptionSelect({ dimension, value, onChange, presetValue }: Props) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language !== 'en'
  const label = zh ? dimension.label_zh : dimension.label_en
  const selected = dimension.options.find((o) => o.key === value)
  const fromPreset = value != null && presetValue === value

  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        {label}
        {fromPreset && (
          <span
            className="rounded bg-violet-950/60 px-1 py-px text-[9px] text-violet-300"
            title={t('camera.fromPreset')}
          >
            {t('camera.presetChip')}
          </span>
        )}
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        title={selected?.fragment ?? ''}
        className="rounded-lg border border-night-600 bg-night-900 px-2.5 py-1.5 text-sm text-slate-200 focus:border-accent focus:outline-none"
      >
        <option value="">{t('camera.unspecified')}</option>
        {dimension.options.map((o) => (
          <option key={o.key} value={o.key} title={o.fragment}>
            {zh ? o.label_zh : o.label_en}
          </option>
        ))}
      </select>
      {selected && <span className="truncate text-[10px] text-slate-600" title={selected.fragment}>→ {selected.fragment}</span>}
    </label>
  )
}
