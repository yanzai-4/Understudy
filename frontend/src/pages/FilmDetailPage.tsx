import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import type { Film, Shot, ShotFilters, ShotGroups } from '../api/types'
import {
  createShot,
  deleteShot,
  duplicateShot,
  getFilm,
  getFilmTags,
  listShotsGrouped,
  updateFilm,
  updateShot,
} from '../api/endpoints'
import ShotCard from '../components/shot/ShotCard'
import ShotFilterBar from '../components/shot/ShotFilterBar'
import ViewToggle, { type FilmView } from '../components/shot/ViewToggle'
import ShotFormModal, { type ShotFormValues } from '../components/shot/ShotFormModal'
import ConfirmDialog from '../components/common/ConfirmDialog'
import EmptyState from '../components/common/EmptyState'
import Button from '../components/common/Button'
import StylePresetEditor from '../components/film/StylePresetEditor'
import FilmBoard from '../components/board/FilmBoard'
import { useNavStore } from '../stores/navStore'

export default function FilmDetailPage() {
  const { t } = useTranslation()
  const { filmId = '' } = useParams()

  const [film, setFilm] = useState<Film | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [filters, setFilters] = useState<ShotFilters>({})
  // Always open on the storyboard; the whiteboard is an explicit mode switch.
  const [view, setView] = useState<FilmView>('storyboard')
  const [grouped, setGrouped] = useState<ShotGroups | null>(null)
  const [boardEpoch, setBoardEpoch] = useState(0) // remount board after external shot changes

  const [formOpen, setFormOpen] = useState(false)
  const [editingShot, setEditingShot] = useState<Shot | null>(null)
  const [deletingShot, setDeletingShot] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  const [editName, setEditName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [presetOpen, setPresetOpen] = useState(false)

  const changeView = (v: FilmView) => {
    setView(v)
    if (v === 'board') setBoardEpoch((n) => n + 1)
  }

  const reloadFilm = useCallback(async () => {
    const [f, tg] = await Promise.all([getFilm(filmId), getFilmTags(filmId)])
    setFilm(f)
    setTags(tg)
  }, [filmId])

  const reloadShots = useCallback(async () => {
    setGrouped(await listShotsGrouped(filmId, filters))
  }, [filmId, filters])

  useEffect(() => {
    reloadFilm().catch(console.error)
  }, [reloadFilm])

  useEffect(() => {
    reloadShots().catch(console.error)
  }, [reloadShots])

  // Publish breadcrumb for the sidebar sub-tree (follows renames too).
  const setNav = useNavStore((s) => s.setNav)
  useEffect(() => {
    if (film) setNav({ id: film.id, name: film.name })
  }, [film, setNav])

  const sceneOptions = useMemo(() => {
    const set = new Set<number>()
    grouped?.groups.forEach((g) => g.scene_no != null && set.add(g.scene_no))
    return [...set].sort((a, b) => a - b)
  }, [grouped])

  // Pipeline distribution across every shot (draft / extracted / exported).
  const statusCounts = useMemo(() => {
    const counts = { draft: 0, extracted: 0, exported: 0 }
    grouped?.groups.forEach((g) => g.shots.forEach((s) => (counts[s.status] += 1)))
    return counts
  }, [grouped])
  const totalShots = statusCounts.draft + statusCounts.extracted + statusCounts.exported

  const refresh = async () => {
    await Promise.all([reloadShots(), reloadFilm()])
  }

  const handleShotSubmit = async (values: ShotFormValues) => {
    if (editingShot) {
      await updateShot(editingShot.id, {
        name: values.name,
        scene_no: values.scene_no,
        clear_scene_no: values.scene_no === null,
        tags: values.tags,
        notes: values.notes,
      })
    } else {
      await createShot(filmId, values)
    }
    await refresh()
  }

  const handleDeleteShot = async () => {
    if (!deletingShot) return
    setBusy(true)
    try {
      await deleteShot(deletingShot.id)
      setDeletingShot(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const togglePick = async (shot: Shot) => {
    await updateShot(shot.id, { is_picked: !shot.is_picked })
    await reloadShots()
  }

  const saveName = async () => {
    if (film && nameDraft.trim() && nameDraft.trim() !== film.name) {
      setFilm(await updateFilm(film.id, { name: nameDraft.trim() }))
    }
    setEditName(false)
  }

  const shotCardProps = (shot: Shot) => ({
    shot,
    onTogglePick: () => togglePick(shot),
    onEdit: () => {
      setEditingShot(shot)
      setFormOpen(true)
    },
    onDelete: () => setDeletingShot(shot),
    onDuplicate: async () => {
      await duplicateShot(shot.id)
      await refresh()
    },
  })

  if (!film) return <div className="p-8 text-sm text-slate-500">{t('common.loading')}</div>

  const isEmpty = view === 'storyboard' && grouped?.total === 0

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      {/* Header */}
      <div className="mb-1 text-xs text-slate-600">
        <Link to="/" className="hover:text-slate-400">
          {t('nav.films')}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-500">{film.name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {editName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            className="rounded-lg border border-night-600 bg-night-900 px-3 py-1.5 text-xl font-semibold text-slate-100 focus:border-accent focus:outline-none"
          />
        ) : (
          <h1
            className="group flex cursor-pointer items-center gap-2 text-xl font-semibold text-slate-100"
            onClick={() => {
              setNameDraft(film.name)
              setEditName(true)
            }}
            title={t('common.rename')}
          >
            {film.name}
            <svg
              className="opacity-0 transition group-hover:opacity-60"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
            </svg>
          </h1>
        )}
        <div className="flex gap-2 text-[11px] text-slate-500">
          <span className="rounded-full border border-night-700 px-2 py-0.5">
            {t('films.shotCount', { count: film.shot_count })}
          </span>
          <span className="rounded-full border border-night-700 px-2 py-0.5">
            {t('films.sceneCount', { count: film.scene_count })}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPresetOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-night-600 px-3 py-2 text-xs text-slate-400 transition hover:border-violet-500/50 hover:text-violet-300"
            title={t('preset.hint')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="13.5" cy="6.5" r="2.5" />
              <circle cx="19" cy="13" r="2" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="10" cy="19" r="2" />
            </svg>
            {t('preset.button')}
          </button>
          <Button
            onClick={() => {
              setEditingShot(null)
              setFormOpen(true)
            }}
          >
            + {t('shots.newShot')}
          </Button>
        </div>
      </div>
      {film.description && <p className="mt-1 text-xs text-slate-500">{film.description}</p>}

      {/* Pipeline distribution bar */}
      {totalShots > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex h-1.5 w-52 overflow-hidden rounded-full bg-night-800">
            <div
              className="bg-slate-600 transition-all duration-500"
              style={{ width: `${(statusCounts.draft / totalShots) * 100}%` }}
            />
            <div
              className="bg-accent transition-all duration-500"
              style={{ width: `${(statusCounts.extracted / totalShots) * 100}%` }}
            />
            <div
              className="bg-emerald-400 transition-all duration-500"
              style={{ width: `${(statusCounts.exported / totalShots) * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <i className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              {t('shots.status.draft')} {statusCounts.draft}
            </span>
            <span className="flex items-center gap-1">
              <i className="h-1.5 w-1.5 rounded-full bg-accent" />
              {t('shots.status.extracted')} {statusCounts.extracted}
            </span>
            <span className="flex items-center gap-1">
              <i className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t('shots.status.exported')} {statusCounts.exported}
            </span>
          </div>
        </div>
      )}

      {/* Filters */}
      {view === 'storyboard' ? (
        <div className="mt-5">
          <ShotFilterBar
            filters={filters}
            onChange={setFilters}
            sceneOptions={sceneOptions}
            tagOptions={tags}
            trailing={<ViewToggle value={view} onChange={changeView} />}
          />
        </div>
      ) : (
        <div className="mt-5 flex items-center justify-end gap-3">
          <span className="text-[11px] text-slate-600">{t('board.dragHint')}</span>
          <ViewToggle value={view} onChange={changeView} />
        </div>
      )}

      {/* Content */}
      {isEmpty && (
        <EmptyState
          icon="🎥"
          text={
            Object.values(filters).some((v) => (Array.isArray(v) ? v.length : v))
              ? t('shots.noResults')
              : t('shots.empty')
          }
        />
      )}

      {view === 'storyboard' && grouped && grouped.total > 0 && (
        <div className="mt-6 flex flex-col gap-8">
          {grouped.groups.map((group) => {
            const exported = group.shots.filter((s) => s.status === 'exported').length
            const hasPick = group.shots.some((s) => s.is_picked)
            return (
              <section key={group.scene_no ?? 'none'}>
                <div className="mb-3 flex items-baseline gap-3">
                  {group.scene_no != null ? (
                    <span className="select-none font-mono text-3xl font-bold leading-none text-night-600">
                      {String(group.scene_no).padStart(2, '0')}
                    </span>
                  ) : (
                    <span className="select-none font-mono text-3xl font-bold leading-none text-night-700">
                      —
                    </span>
                  )}
                  <h2 className="text-sm font-semibold text-slate-300">
                    {group.scene_no != null
                      ? t('shots.sceneN', { n: group.scene_no })
                      : t('shots.unassignedScene')}
                  </h2>
                  <span className="text-[11px] text-slate-600">
                    {group.shots.length} {hasPick && '· ★'}
                    {exported > 0 && ` · ${t('films.exportedCount', { count: exported })}`}
                  </span>
                  <span className="h-px flex-1 self-center bg-gradient-to-r from-night-700 to-transparent" />
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                  {group.shots.map((shot) => (
                    <ShotCard key={shot.id} {...shotCardProps(shot)} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {view === 'board' && (
        <div className="mt-3">
          <FilmBoard key={boardEpoch} filmId={filmId} onShotsChanged={() => reloadShots()} />
        </div>
      )}

      <ShotFormModal
        open={formOpen}
        shot={editingShot}
        tagSuggestions={tags}
        onClose={() => setFormOpen(false)}
        onSubmit={handleShotSubmit}
      />
      <ConfirmDialog
        open={deletingShot !== null}
        title={t('shots.deleteTitle')}
        message={t('shots.deleteMessage', { name: deletingShot?.name ?? '' })}
        onConfirm={handleDeleteShot}
        onCancel={() => setDeletingShot(null)}
        busy={busy}
      />
      <StylePresetEditor
        open={presetOpen}
        film={film}
        onClose={() => setPresetOpen(false)}
        onSaved={setFilm}
      />
    </div>
  )
}
