import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Film, Page } from '../api/types'
import { createFilm, deleteFilm, listFilms, updateFilm } from '../api/endpoints'
import FilmCard from '../components/film/FilmCard'
import FilmFormModal from '../components/film/FilmFormModal'
import WorkflowGuide from '../components/film/WorkflowGuide'
import ConfirmDialog from '../components/common/ConfirmDialog'
import EmptyState from '../components/common/EmptyState'
import Pagination from '../components/common/Pagination'
import SearchInput from '../components/common/SearchInput'
import Button from '../components/common/Button'

const GUIDE_KEY = 'understudy.guide.dismissed'

export default function FilmListPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<Page<Film> | null>(null)
  const [guideDismissed, setGuideDismissed] = useState(() => localStorage.getItem(GUIDE_KEY) === '1')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('updated')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Film | null>(null)
  const [deleting, setDeleting] = useState<Film | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setData(await listFilms({ search, sort, page }))
  }, [search, sort, page])

  useEffect(() => {
    reload().catch(console.error)
  }, [reload])

  const handleSubmit = async (values: { name: string; description: string }) => {
    if (editing) {
      await updateFilm(editing.id, values)
    } else {
      await createFilm(values)
    }
    await reload()
  }

  const handleDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteFilm(deleting.id)
      setDeleting(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-100">{t('films.title')}</h1>
        {guideDismissed && (
          <button
            onClick={() => {
              localStorage.removeItem(GUIDE_KEY)
              setGuideDismissed(false)
            }}
            title={t('guide.reopen')}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-night-600 text-xs text-slate-500 transition hover:border-accent hover:text-cyan-300"
          >
            ?
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder={t('films.searchPlaceholder')}
            className="w-56"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-night-600 bg-night-900 px-2 py-1.5 text-xs text-slate-300 focus:border-accent focus:outline-none"
          >
            <option value="updated">{t('films.sortUpdated')}</option>
            <option value="created">{t('films.sortCreated')}</option>
            <option value="name">{t('films.sortName')}</option>
          </select>
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            + {t('films.newFilm')}
          </Button>
        </div>
      </div>

      {!guideDismissed && (
        <WorkflowGuide
          onDismiss={() => {
            localStorage.setItem(GUIDE_KEY, '1')
            setGuideDismissed(true)
          }}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState text={search ? t('films.noResults') : t('films.empty')} />
      )}

      {data && data.items.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {data.items.map((film) => (
            <FilmCard
              key={film.id}
              film={film}
              onEdit={() => {
                setEditing(film)
                setFormOpen(true)
              }}
              onDelete={() => setDeleting(film)}
            />
          ))}
        </div>
      )}

      {data && (
        <Pagination page={data.page} pageSize={data.page_size} total={data.total} onChange={setPage} />
      )}

      <FilmFormModal
        open={formOpen}
        film={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('films.deleteTitle')}
        message={t('films.deleteMessage', {
          name: deleting?.name ?? '',
          count: deleting?.shot_count ?? 0,
        })}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
        busy={busy}
      />
    </div>
  )
}
