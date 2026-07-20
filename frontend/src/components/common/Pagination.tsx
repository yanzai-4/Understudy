import { useTranslation } from 'react-i18next'

interface Props {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}

export default function Pagination({ page, pageSize, total, onChange }: Props) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null

  const btn =
    'rounded-md border border-night-600 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-night-800 disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      <button className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ←
      </button>
      <span className="text-xs text-slate-500">{t('common.page', { page, total: pages })}</span>
      <button className={btn} disabled={page >= pages} onClick={() => onChange(page + 1)}>
        →
      </button>
    </div>
  )
}
