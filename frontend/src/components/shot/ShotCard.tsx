import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { Shot } from '../../api/types'
import StatusBadge from '../common/StatusBadge'
import Dropdown from '../common/Dropdown'

interface Props {
  shot: Shot
  onTogglePick: () => void
  onEdit: () => void
  onDelete: () => void
  onDuplicate?: () => void
}

export default function ShotCard({ shot, onTogglePick, onEdit, onDelete, onDuplicate }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate(`/shots/${shot.id}`)}
      className="group cursor-pointer overflow-hidden rounded-xl border border-night-700 bg-night-800 transition duration-200 hover:-translate-y-1 hover:border-night-500 hover:shadow-lg hover:shadow-blue-950/40"
    >
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-night-700 via-night-800 to-night-900">
        {shot.thumbnail_url ? (
          <img
            src={shot.thumbnail_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl opacity-30">🎥</div>
        )}
        {/* scene / version badges */}
        <div className="absolute left-2 top-2 flex gap-1">
          {shot.scene_no != null && (
            <span className="rounded bg-night-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300 backdrop-blur">
              S{shot.scene_no}
            </span>
          )}
          <span className="rounded bg-night-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 backdrop-blur">
            V{shot.version}
          </span>
        </div>
        {/* pick star */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTogglePick()
          }}
          title={t('shots.pick')}
          className={`absolute right-2 top-2 rounded-md bg-night-900/85 p-1 backdrop-blur transition ${
            shot.is_picked ? 'text-amber-400' : 'text-slate-600 opacity-0 group-hover:opacity-100 hover:text-amber-300'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={shot.is_picked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
            <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
          </svg>
        </button>
      </div>
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium text-slate-100">{shot.name}</div>
          <Dropdown
            items={[
              { label: t('common.edit'), onClick: onEdit },
              {
                label: t('shots.duplicate'),
                onClick: onDuplicate ?? (() => {}),
                disabled: !onDuplicate,
              },
              { label: t('common.delete'), onClick: onDelete, danger: true },
            ]}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <StatusBadge status={shot.status} />
          {shot.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded bg-night-700/70 px-1.5 py-0.5 text-[10px] text-slate-400">
              {tag}
            </span>
          ))}
          {shot.tags.length > 3 && (
            <span className="text-[10px] text-slate-600">+{shot.tags.length - 3}</span>
          )}
        </div>
      </div>
    </div>
  )
}
