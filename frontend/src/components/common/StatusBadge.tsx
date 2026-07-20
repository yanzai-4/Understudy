import { useTranslation } from 'react-i18next'
import type { ShotStatus } from '../../api/types'

const styles: Record<ShotStatus, string> = {
  draft: 'bg-slate-700/50 text-slate-400 border-slate-600/50',
  extracted: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  exported: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
}

export default function StatusBadge({ status }: { status: ShotStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
      {t(`shots.status.${status}`)}
    </span>
  )
}
