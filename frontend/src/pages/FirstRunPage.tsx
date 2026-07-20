import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { HardwareProfile } from '../api/types'
import { getHardware, updateSettings } from '../api/endpoints'
import Button from '../components/common/Button'
import LangToggle from '../components/common/LangToggle'

export default function FirstRunPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hw, setHw] = useState<HardwareProfile | null>(null)
  const [depthVariant, setDepthVariant] = useState<'int8' | 'fp32'>('int8')

  useEffect(() => {
    getHardware().then(setHw).catch(console.error)
  }, [])

  const finish = async () => {
    await updateSettings({
      first_run_completed: true,
      depth_model_variant: depthVariant,
      ...(hw
        ? {
            default_max_size: hw.recommended.default_max_size,
            // Adopt the platform's best in-place backend (CoreML on Apple
            // Silicon, CPU elsewhere). DirectML still requires the Settings
            // switch since it swaps the onnxruntime package.
            ort_provider: hw.recommended.ort_provider === 'directml' ? 'cpu' : hw.recommended.ort_provider,
          }
        : {}),
    })
    navigate('/')
  }

  // Yellow hint under the hardware card, explaining why this tier was chosen.
  const tierHint =
    hw && hw.tier === 'low'
      ? t('firstRun.tierLow', { size: hw.recommended.default_max_size })
      : hw && hw.tier === 'cpu'
        ? t('firstRun.tierCpu', { size: hw.recommended.default_max_size })
        : null

  return (
    <div className="flex h-screen w-full items-center justify-center overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl border border-night-700 bg-night-850 p-8 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{t('firstRun.title')}</h1>
            <p className="mt-1 text-xs text-slate-500">{t('firstRun.subtitle')}</p>
          </div>
          <LangToggle />
        </div>

        {/* Hardware */}
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('firstRun.hardware')}
          </h2>
          {hw ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div className="rounded-lg border border-night-700 bg-night-900 px-3 py-2">
                  CPU · {hw.cpu_cores} {t('firstRun.cores')}
                </div>
                <div className="rounded-lg border border-night-700 bg-night-900 px-3 py-2">
                  RAM · {hw.ram_gb} GB
                </div>
                <div className="col-span-2 rounded-lg border border-night-700 bg-night-900 px-3 py-2">
                  {t('firstRun.provider')} ·{' '}
                  <span className="text-cyan-300">{hw.active_provider.toUpperCase()}</span>
                  <span className="ml-2 text-slate-500">
                    ({t('firstRun.recommendedSize')} {hw.recommended.default_max_size}px)
                  </span>
                </div>
              </div>
              {tierHint && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-400">{tierHint}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-500">{t('common.loading')}</p>
          )}
        </section>

        {/* Depth precision — a preference; models download automatically */}
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('firstRun.depthTitle')}
          </h2>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-night-700 bg-night-900 px-3 py-2.5">
            <span className="text-[11px] text-slate-500">
              {t(`firstRun.depthHint_${depthVariant}`)}
            </span>
            <div className="flex shrink-0 rounded-lg border border-night-600 p-0.5">
              {(['int8', 'fp32'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setDepthVariant(v)}
                  className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                    depthVariant === v
                      ? 'bg-night-700 text-cyan-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t(`firstRun.depth_${v}`)}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            {t('firstRun.autoDownload')}
          </p>
        </section>

        <div className="mt-7 flex items-center justify-end">
          <Button onClick={finish}>{t('firstRun.start')} →</Button>
        </div>
      </div>
    </div>
  )
}
