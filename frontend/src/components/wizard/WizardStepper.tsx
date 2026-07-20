import { useTranslation } from 'react-i18next'

export const WIZARD_STEPS = ['upload', 'extract', 'preview', 'lens', 'camera', 'export'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

interface Props {
  current: number
  unlocked: boolean[] // per-step accessibility
  onSelect: (index: number) => void
}

export default function WizardStepper({ current, unlocked, onSelect }: Props) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1">
      {WIZARD_STEPS.map((step, i) => {
        const active = i === current
        const enabled = unlocked[i]
        return (
          <div key={step} className="flex items-center">
            {i > 0 && <div className={`h-px w-6 ${enabled ? 'bg-night-500' : 'bg-night-700'}`} />}
            <button
              disabled={!enabled}
              onClick={() => onSelect(i)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition ${
                active
                  ? 'bg-night-700/70 text-cyan-300'
                  : enabled
                    ? 'text-slate-400 hover:bg-night-800 hover:text-slate-200'
                    : 'cursor-not-allowed text-slate-700'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  active
                    ? 'border-cyan-400 text-cyan-300'
                    : enabled
                      ? 'border-night-500 text-slate-400'
                      : 'border-night-700 text-slate-700'
                }`}
              >
                {i + 1}
              </span>
              {t(`wizard.steps.${step}`)}
            </button>
          </div>
        )
      })}
    </div>
  )
}
