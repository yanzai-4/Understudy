import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../common/Button'

const GROUPS = ['building', 'props', 'vehicle', 'person', 'animal'] as const

interface Props {
  onSubmit: (group: string, label: string) => void
  onCancel: () => void
}

/** Inline form shown after a lasso region is drawn: pick a group + optional
 * label. Replaces the old BackgroundEditModal. */
export default function ManualSubjectForm({ onSubmit, onCancel }: Props) {
  const { t } = useTranslation()
  const [group, setGroup] = useState<string>('building')
  const [label, setLabel] = useState('')
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-cyan-500/40 bg-night-800 p-2.5">
      <select
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        className="rounded border border-night-600 bg-night-900 px-2 py-1 text-xs text-slate-200"
      >
        {GROUPS.map((g) => (
          <option key={g} value={g}>
            {t(`layout.group.${g}`)}
          </option>
        ))}
      </select>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit(group, label.trim())}
        placeholder={t('layout.drawLabelPlaceholder')}
        className="rounded border border-night-600 bg-night-900 px-2 py-1 text-xs text-slate-200"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => onSubmit(group, label.trim())}>{t('common.add')}</Button>
      </div>
    </div>
  )
}
