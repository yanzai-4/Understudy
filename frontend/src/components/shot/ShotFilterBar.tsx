import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShotFilters } from '../../api/types'
import SearchInput from '../common/SearchInput'

interface Props {
  filters: ShotFilters
  onChange: (filters: ShotFilters) => void
  sceneOptions: number[]
  tagOptions: string[]
  /** Rendered right-aligned on the first row (e.g. the view toggle). */
  trailing?: ReactNode
}

const select =
  'rounded-lg border border-night-600 bg-night-900 px-2 py-1.5 text-xs text-slate-300 focus:border-accent focus:outline-none'

export default function ShotFilterBar({ filters, onChange, sceneOptions, tagOptions, trailing }: Props) {
  const { t } = useTranslation()
  const patch = (p: Partial<ShotFilters>) => onChange({ ...filters, ...p })
  const activeTags = filters.tags ?? []

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filters.search ?? ''}
          onChange={(search) => patch({ search })}
          placeholder={t('shots.searchPlaceholder')}
          className="w-56"
        />
        <select
          className={select}
          value={filters.scene_no ?? ''}
          onChange={(e) => patch({ scene_no: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">{t('shots.allScenes')}</option>
          {sceneOptions.map((s) => (
            <option key={s} value={s}>
              {t('shots.sceneN', { n: s })}
            </option>
          ))}
        </select>
        <select
          className={select}
          value={filters.status ?? ''}
          onChange={(e) => patch({ status: e.target.value as ShotFilters['status'] })}
        >
          <option value="">{t('shots.allStatus')}</option>
          <option value="draft">{t('shots.status.draft')}</option>
          <option value="extracted">{t('shots.status.extracted')}</option>
          <option value="exported">{t('shots.status.exported')}</option>
        </select>
        <button
          onClick={() => patch({ picked: !filters.picked })}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition ${
            filters.picked
              ? 'border-amber-500/60 bg-amber-950/30 text-amber-300'
              : 'border-night-600 text-slate-400 hover:bg-night-800'
          }`}
        >
          ★ {t('shots.pickedOnly')}
        </button>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
      {tagOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-600">{t('shots.tagsLabel')}:</span>
          {tagOptions.map((tag) => {
            const active = activeTags.includes(tag)
            return (
              <button
                key={tag}
                onClick={() =>
                  patch({ tags: active ? activeTags.filter((x) => x !== tag) : [...activeTags, tag] })
                }
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                  active
                    ? 'border-accent/70 bg-blue-950/50 text-cyan-300'
                    : 'border-night-600 text-slate-400 hover:border-night-500'
                }`}
              >
                {tag}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
