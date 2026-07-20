import { useEffect } from 'react'
import {
  BrowserRouter,
  matchPath,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getSettings } from './api/endpoints'
import { setLanguage } from './i18n'
import { useNavStore } from './stores/navStore'
import Logo from './components/common/Logo'
import SplashScreen from './components/common/SplashScreen'
import FilmListPage from './pages/FilmListPage'
import FilmDetailPage from './pages/FilmDetailPage'
import ShotWizardPage from './pages/ShotWizardPage'
import SettingsPage from './pages/SettingsPage'
import FirstRunPage from './pages/FirstRunPage'

function Sidebar() {
  const { t, i18n } = useTranslation()
  const nextLang = i18n.language === 'en' ? 'zh' : 'en'
  const location = useLocation()
  const { film, shot } = useNavStore()

  const onFilmPage = matchPath('/films/:filmId', location.pathname) !== null
  const onShotPage = matchPath('/shots/:shotId', location.pathname) !== null
  const showFilm = (onFilmPage || onShotPage) && film !== null
  const showShot = onShotPage && shot !== null

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive
        ? 'bg-night-700/60 text-cyan-300'
        : 'text-slate-400 hover:bg-night-800 hover:text-slate-200'
    }`

  const subItem = (active: boolean) =>
    `flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
      active
        ? 'bg-night-700/50 text-cyan-300'
        : 'text-slate-500 hover:bg-night-800 hover:text-slate-300'
    }`

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-night-800 bg-night-900/70 backdrop-blur">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <Logo size={30} idPrefix="side" className="shrink-0" />
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight tracking-wide text-slate-100">
            Under<span className="text-cyan-400">study</span>
          </div>
          <div className="truncate text-[10px] leading-tight text-slate-500">{t('app.tagline')}</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1 px-3">
        <NavLink to="/" end className={linkClass}>
          <FilmIcon /> {t('nav.films')}
        </NavLink>

        {/* Animated breadcrumb sub-tree: film → shot */}
        <div className={`subnav ${showFilm ? 'subnav-open' : ''}`}>
          <div className="subnav-inner">
            <div className="ml-[1.35rem] border-l border-night-700 pl-2 pt-0.5">
              <NavLink to={film ? `/films/${film.id}` : '/'} className={subItem(onFilmPage)}>
                <svg className="shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                </svg>
                <span className="truncate">{film?.name}</span>
              </NavLink>
              <div className={`subnav ${showShot ? 'subnav-open' : ''}`}>
                <div className="subnav-inner">
                  <div className="ml-3 border-l border-night-700 pl-2 pt-0.5">
                    <div className={subItem(onShotPage)}>
                      {shot?.scene_no != null && (
                        <span className="shrink-0 rounded bg-night-700 px-1 text-[9px] font-semibold text-cyan-300">
                          S{shot.scene_no}
                        </span>
                      )}
                      <span className="truncate">{shot?.name}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <NavLink to="/settings" className={linkClass}>
          <GearIcon /> {t('nav.settings')}
        </NavLink>
      </nav>
      {/* Footer: quiet meta row — version + language switch */}
      <div className="mt-auto flex items-center justify-between border-t border-night-800 px-4 py-2.5">
        <span className="text-[10px] tracking-wide text-slate-600">v{__APP_VERSION__}</span>
        <button
          onClick={() => setLanguage(nextLang)}
          title={nextLang === 'en' ? 'Switch to English' : '切换为中文'}
          className="flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-cyan-300"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
          </svg>
          {i18n.language === 'en' ? 'EN' : '中文'}
        </button>
      </div>
    </aside>
  )
}

function FilmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  )
}

function FirstRunGate() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (!s.first_run_completed && location.pathname !== '/first-run') {
          navigate('/first-run', { replace: true })
        }
      })
      .catch(() => {
        /* backend unreachable: stay put */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <SplashScreen />
      <FirstRunGate />
      <div className="flex h-screen overflow-hidden">
        <Routes>
          <Route path="/first-run" element={<FirstRunPage />} />
          <Route
            path="*"
            element={
              <>
                <Sidebar />
                <main className="flex-1 overflow-y-auto">
                  <Routes>
                    <Route path="/" element={<FilmListPage />} />
                    <Route path="/films/:filmId" element={<FilmDetailPage />} />
                    <Route path="/shots/:shotId" element={<ShotWizardPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </main>
              </>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
