import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, HardwareProfile, ModelInfo, OrtProvider } from '../api/types'
import {
  getHardware,
  getSettings,
  listModels,
  resetAll,
  switchProvider,
  updateSettings,
} from '../api/endpoints'
import { setLanguage } from '../i18n'
import Button from '../components/common/Button'
import ConfirmDialog from '../components/common/ConfirmDialog'
import Modal from '../components/common/Modal'

const RESET_PHRASE = 'Understudy'

const section = 'rounded-xl border border-night-700 bg-night-800 p-5'
const select =
  'rounded-lg border border-night-600 bg-night-900 px-2.5 py-1.5 text-sm text-slate-200 focus:border-accent focus:outline-none'

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [hw, setHw] = useState<HardwareProfile | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [pendingProvider, setPendingProvider] = useState<OrtProvider | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [manualGuide, setManualGuide] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error)
    getHardware().then(setHw).catch(console.error)
    listModels().then(setModels).catch(console.error)
  }, [])

  const patch = async (values: Partial<AppSettings>) => {
    const next = await updateSettings(values)
    setSettings(next)
    if (values.language) setLanguage(values.language)
  }

  const closeReset = () => {
    if (resetting) return
    setResetOpen(false)
    setResetText('')
  }

  const confirmReset = async () => {
    if (resetText.trim() !== RESET_PHRASE) return
    setResetting(true)
    try {
      await resetAll(RESET_PHRASE, i18n.language === 'en' ? 'en' : 'zh')
      window.location.assign('/')
    } catch (e) {
      console.error(e)
      setResetting(false)
    }
  }

  const providerLabel = (p: OrtProvider) =>
    p === 'directml' ? 'DirectML (GPU)' : p === 'coreml' ? 'CoreML (GPU)' : 'CPU'

  // The GPU backend this platform can toggle to. On Windows DirectML is always
  // offered (choosing it installs the package); on macOS CoreML is offered when
  // the onnxruntime build exposes it.
  const gpuOption: OrtProvider | null = !hw
    ? null
    : hw.os === 'windows'
      ? 'directml'
      : hw.gpu_provider === 'coreml' || hw.gpu_provider === 'directml'
        ? hw.gpu_provider
        : null
  const providerOptions: OrtProvider[] = ['cpu', ...(gpuOption ? [gpuOption] : [])]
  // Only Windows swaps the onnxruntime package (and needs a confirm + restart);
  // macOS CoreML/CPU switch instantly.
  const providerNeedsRestart = hw?.os === 'windows'

  const chooseProvider = (p: OrtProvider) => {
    if (!settings || settings.ort_provider === p) return
    if (providerNeedsRestart) setPendingProvider(p)
    else applyProviderInstant(p)
  }

  const applyProviderInstant = async (provider: OrtProvider) => {
    try {
      await switchProvider(provider)
      setSettings((s) => (s ? { ...s, ort_provider: provider } : s))
    } catch (e) {
      console.error(e)
    }
  }

  const applyProviderSwitch = async () => {
    if (!pendingProvider) return
    const provider = pendingProvider
    setPendingProvider(null)
    try {
      const res = await switchProvider(provider)
      setSettings((s) => (s ? { ...s, ort_provider: provider } : s))
      if (res.restarting) setRestarting(true)
      else if (res.manual) setManualGuide(true)
    } catch (e) {
      console.error(e)
    }
  }

  if (restarting) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-night-600 border-t-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-200">{t('provider.restartingTitle')}</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">{t('provider.restartingBody')}</p>
        </div>
      </div>
    )
  }

  if (!settings) return <div className="p-8 text-sm text-slate-500">{t('common.loading')}</div>

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-8">
      <h1 className="text-xl font-semibold text-slate-100">{t('settings.title')}</h1>

      {/* Language */}
      <div className={section}>
        <h2 className="mb-3 text-sm font-medium text-slate-200">{t('settings.language')}</h2>
        <select
          className={select}
          value={settings.language}
          onChange={(e) => patch({ language: e.target.value as 'zh' | 'en' })}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      {/* Inference backend */}
      <div className={section}>
        <h2 className="mb-1 text-sm font-medium text-slate-200">{t('settings.provider')}</h2>
        <p className="mb-3 text-[11px] text-slate-600">{t('settings.providerHint')}</p>
        <div className="flex gap-2">
          {providerOptions.map((p) => (
            <button
              key={p}
              onClick={() => chooseProvider(p)}
              className={`rounded-lg border px-4 py-2 text-sm transition ${
                settings.ort_provider === p
                  ? 'border-accent/70 bg-blue-950/40 text-cyan-300'
                  : 'border-night-600 text-slate-400 hover:border-night-500'
              }`}
            >
              {providerLabel(p)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          {providerNeedsRestart ? t('settings.providerAutoNote') : t('settings.providerInstantNote')}
        </p>
        {manualGuide && (
          <div className="mt-3 rounded-lg border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-xs leading-relaxed text-amber-200">
            {t('settings.reinstallGuide')}
            <code className="mt-1.5 block rounded bg-night-950 px-2 py-1 font-mono text-[11px] text-amber-100">
              scripts\switch_directml.ps1
            </code>
          </div>
        )}
      </div>

      {/* Extraction defaults */}
      <div className={section}>
        <h2 className="mb-3 text-sm font-medium text-slate-200">{t('settings.extraction')}</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-xs text-slate-400">
            {t('settings.defaultMaxSize')}
            <select
              className={select}
              value={settings.default_max_size}
              onChange={(e) => patch({ default_max_size: Number(e.target.value) })}
            >
              {[512, 768, 960].map((n) => (
                <option key={n} value={n}>
                  {n}px
                  {n === hw?.recommended.default_max_size ? t('settings.recommendedForDevice') : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-slate-400">
            {t('settings.depthVariant')}
            <select
              className={select}
              value={settings.depth_model_variant}
              onChange={(e) => patch({ depth_model_variant: e.target.value as 'int8' | 'fp32' })}
            >
              <option value="int8">int8（{t('settings.depthFast')}）</option>
              <option value="fp32">fp32（{t('settings.depthAccurate')}）</option>
            </select>
          </label>
        </div>
      </div>

      {/* Models — read-only status; downloads happen automatically */}
      <div className={section}>
        <h2 className="mb-1 text-sm font-medium text-slate-200">{t('settings.models')}</h2>
        <p className="mb-3 text-[11px] text-slate-600">{t('settings.modelsHint')}</p>
        <div className="flex flex-col gap-2">
          {models.map((m) => (
            <div
              key={m.key}
              className="flex items-center gap-3 rounded-lg border border-night-700 bg-night-900 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-200">{m.name}</div>
                <div className="text-[10px] text-slate-600">≈{m.size_mb} MB</div>
              </div>
              {m.status === 'ready' ? (
                <span className="text-xs text-emerald-300">✓ {t('firstRun.ready')}</span>
              ) : (
                <span className="text-xs text-slate-500">{t('settings.modelAuto')}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Hardware */}
      <div className={section}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-200">{t('firstRun.hardware')}</h2>
          <Button
            variant="ghost"
            className="!px-2.5 !py-1 !text-xs"
            onClick={() => getHardware(true).then(setHw)}
          >
            {t('settings.redetect')}
          </Button>
        </div>
        {hw ? (
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div>CPU · {hw.cpu_cores} {t('firstRun.cores')}</div>
            <div>RAM · {hw.ram_gb} GB</div>
            <div className="col-span-2">
              Providers · <span className="font-mono text-[11px]">{hw.available_providers.join(', ')}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-600">{t('common.loading')}</p>
        )}
      </div>

      {/* Danger zone — reset everything */}
      <div className="rounded-xl border border-red-900/50 bg-red-950/15 p-5">
        <h2 className="mb-1 text-sm font-medium text-red-300">{t('reset.title')}</h2>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">{t('reset.hint')}</p>
        <Button variant="danger" onClick={() => setResetOpen(true)}>
          {t('reset.button')}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingProvider !== null}
        title={t('provider.confirmTitle')}
        message={t('provider.confirmBody', {
          target: pendingProvider ? providerLabel(pendingProvider) : '',
        })}
        confirmLabel={t('provider.confirmBtn')}
        onConfirm={applyProviderSwitch}
        onCancel={() => setPendingProvider(null)}
      />

      <Modal
        open={resetOpen}
        onClose={closeReset}
        title={t('reset.title')}
        footer={
          <>
            <Button variant="ghost" onClick={closeReset} disabled={resetting}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={confirmReset}
              disabled={resetting || resetText.trim() !== RESET_PHRASE}
            >
              {resetting ? t('reset.working') : t('reset.confirmBtn')}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-400">{t('reset.warning')}</p>
        <p className="mt-3 text-xs text-slate-500">
          {t('reset.typePrompt')}{' '}
          <code className="rounded bg-night-950 px-1.5 py-0.5 font-mono text-[12px] text-red-300">
            {RESET_PHRASE}
          </code>
        </p>
        <input
          autoFocus
          value={resetText}
          onChange={(e) => setResetText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && confirmReset()}
          placeholder={RESET_PHRASE}
          disabled={resetting}
          className="mt-2 w-full rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-red-500 focus:outline-none"
        />
      </Modal>
    </div>
  )
}
