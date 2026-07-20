import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import type { Film, Shot } from '../api/types'
import { getFilm, getShot } from '../api/endpoints'
import { clearWizardStep, loadWizardStep, saveWizardStep } from '../lib/wizardStep'
import { useNavStore } from '../stores/navStore'
import WizardStepper from '../components/wizard/WizardStepper'
import StepUpload from '../components/wizard/StepUpload'
import StepExtract from '../components/wizard/StepExtract'
import StepPreview from '../components/wizard/StepPreview'
import StepLens from '../components/wizard/StepLens'
import StepCamera from '../components/wizard/StepCamera'
import StepExport from '../components/wizard/StepExport'

/** Highest step index reachable given the shot's current state. */
function maxUnlockedStep(shot: Shot): number {
  if (shot.status === 'extracted' || shot.status === 'exported') return 5
  if (shot.video_frame_count != null) return 1
  return 0
}

export default function ShotWizardPage() {
  const { t } = useTranslation()
  const { shotId = '' } = useParams()
  const [shot, setShot] = useState<Shot | null>(null)
  const [film, setFilm] = useState<Film | null>(null)
  const [step, setStep] = useState<number | null>(null)

  useEffect(() => {
    getShot(shotId)
      .then(async (s) => {
        setShot(s)
        setFilm(await getFilm(s.film_id))
        // Restore the remembered step (furthest reached), clamped to what the
        // shot's state currently unlocks; otherwise fall back to a sensible
        // default derived from status.
        const ceil = maxUnlockedStep(s)
        const remembered = loadWizardStep(s.id)
        setStep(remembered != null ? Math.min(remembered, ceil) : ceil)
      })
      .catch(console.error)
  }, [shotId])

  // Publish breadcrumb (film → shot) for the sidebar sub-tree.
  const setNav = useNavStore((s) => s.setNav)
  useEffect(() => {
    if (film && shot) {
      setNav(
        { id: film.id, name: film.name },
        { id: shot.id, name: shot.name, scene_no: shot.scene_no },
      )
    }
  }, [film, shot, setNav])

  // Navigate + remember the furthest step reached.
  const goToStep = useCallback(
    (index: number) => {
      setStep(index)
      saveWizardStep(shotId, index)
    },
    [shotId],
  )

  // Re-uploading resets the flow: the remembered position is wiped so the
  // user starts over rather than jumping back to a later step.
  const handleVideoReplaced = useCallback(
    (updated: Shot) => {
      clearWizardStep(shotId)
      setShot(updated)
      setStep(0)
    },
    [shotId],
  )

  const unlocked = useMemo(() => {
    if (!shot) return [true, false, false, false, false, false]
    const hasVideo = shot.video_frame_count != null
    const extracted = shot.status === 'extracted' || shot.status === 'exported'
    return [true, hasVideo, extracted, extracted, extracted, extracted]
  }, [shot])

  if (!shot || step === null)
    return <div className="p-8 text-sm text-slate-500">{t('common.loading')}</div>

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      {/* Breadcrumb */}
      <div className="mb-1 text-xs text-slate-600">
        <Link to="/" className="hover:text-slate-400">
          {t('nav.films')}
        </Link>
        <span className="mx-1.5">/</span>
        <Link to={`/films/${shot.film_id}`} className="hover:text-slate-400">
          {film?.name ?? '…'}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-500">{shot.name}</span>
      </div>

      {/* Title row */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-100">
          {shot.name}
          {shot.scene_no != null && (
            <span className="ml-2 text-sm font-normal text-cyan-400">S{shot.scene_no}</span>
          )}
          <span className="ml-1.5 text-sm font-normal text-slate-500">V{shot.version}</span>
        </h1>
        <div className="ml-auto">
          <WizardStepper current={step} unlocked={unlocked} onSelect={goToStep} />
        </div>
      </div>

      {/* Step content */}
      <div className="mt-8">
        {step === 0 && (
          <StepUpload
            shot={shot}
            onShotUpdated={setShot}
            onVideoReplaced={handleVideoReplaced}
            onNext={() => goToStep(1)}
          />
        )}
        {step === 1 && (
          <StepExtract shot={shot} onShotUpdated={setShot} onNext={() => goToStep(2)} />
        )}
        {step === 2 && <StepPreview shot={shot} onNext={() => goToStep(3)} />}
        {step === 3 && <StepLens shot={shot} onNext={() => goToStep(4)} />}
        {step === 4 && <StepCamera shot={shot} film={film} onNext={() => goToStep(5)} />}
        {step === 5 && <StepExport shot={shot} onShotUpdated={setShot} />}
      </div>
    </div>
  )
}
