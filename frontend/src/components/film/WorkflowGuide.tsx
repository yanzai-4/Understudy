import { useTranslation } from 'react-i18next'

const STEPS = [
  {
    key: 'create',
    color: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/30',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M12 9v6m-3-3h6" />
      </svg>
    ),
  },
  {
    key: 'upload',
    color: 'text-blue-300 border-blue-500/40 bg-blue-950/30',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
        <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
    ),
  },
  {
    key: 'extract',
    color: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-950/30',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v5m0 0-4 6m4-6 4 6m-4-6-5-3m5 3 5-3" />
      </svg>
    ),
  },
  {
    key: 'lens',
    color: 'text-violet-300 border-violet-500/40 bg-violet-950/30',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 4v2m0 12v2M4 12h2m12 0h2" />
      </svg>
    ),
  },
  {
    key: 'export',
    color: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      </svg>
    ),
  },
] as const

/** Five-step "how it works" strip on the films page (visibility lifted to the page). */
export default function WorkflowGuide({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="relative mt-5 rounded-2xl border border-night-700 bg-night-900/60 px-5 pb-5 pt-4">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-sm font-semibold text-slate-200">{t('guide.title')}</h2>
        <span className="text-[11px] text-slate-600">{t('guide.subtitle')}</span>
        <button
          onClick={onDismiss}
          className="ml-auto rounded-md p-1 text-slate-600 transition hover:bg-night-700 hover:text-slate-300"
          title={t('common.close')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {STEPS.map((step, i) => (
          <div key={step.key} className="relative">
            <div className="flex h-full flex-col gap-2 rounded-xl border border-night-700 bg-night-850 p-3.5">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${step.color}`}
                >
                  {step.icon}
                </span>
                <span className="font-mono text-[10px] text-slate-600">0{i + 1}</span>
              </div>
              <div className="text-xs font-medium text-slate-200">{t(`guide.${step.key}.title`)}</div>
              <div className="text-[11px] leading-relaxed text-slate-500">
                {t(`guide.${step.key}.desc`)}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <span className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-night-500 md:block">
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
