import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { Film } from '../../api/types'
import { relativeTime } from '../../lib/format'
import Dropdown from '../common/Dropdown'

interface Props {
  film: Film
  onEdit: () => void
  onDelete: () => void
}

export default function FilmCard({ film, onEdit, onDelete }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate(`/films/${film.id}`)}
      className="group cursor-pointer overflow-hidden rounded-xl border border-night-700 bg-night-800 transition duration-200 hover:-translate-y-1 hover:border-night-500 hover:shadow-lg hover:shadow-blue-950/40"
    >
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-night-700 via-night-800 to-night-900">
        {film.cover_url ? (
          <img
            src={film.cover_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl opacity-30">🎬</div>
        )}
        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
          <div className="rounded-md bg-night-900/80 backdrop-blur">
            <Dropdown
              items={[
                { label: t('common.edit'), onClick: onEdit },
                { label: t('common.delete'), onClick: onDelete, danger: true },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="px-3.5 py-3">
        <div className="truncate text-sm font-medium text-slate-100">{film.name}</div>
        {film.description && (
          <div className="mt-0.5 truncate text-xs text-slate-500">{film.description}</div>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            {t('films.stats', {
              shots: film.shot_count,
              scenes: film.scene_count,
              exported: film.exported_count,
            })}
          </span>
          <span>{relativeTime(film.updated_at)}</span>
        </div>
      </div>
    </div>
  )
}
