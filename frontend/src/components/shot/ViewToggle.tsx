import { useTranslation } from 'react-i18next'

export type FilmView = 'storyboard' | 'board'

export default function ViewToggle({
  value,
  onChange,
}: {
  value: FilmView
  onChange: (view: FilmView) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex rounded-lg border border-night-600 p-0.5">
      {(['storyboard', 'board'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs transition ${
            value === v ? 'bg-night-700 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {t(`shots.view.${v}`)}
        </button>
      ))}
    </div>
  )
}
