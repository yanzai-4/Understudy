import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CameraParamsValues,
  Film,
  LensData,
  PromptMappings,
  Shot,
} from '../../api/types'
import {
  getCameraParams,
  getLayoutState,
  getLens,
  getPromptMappings,
  putCameraParams,
} from '../../api/endpoints'
import { lensPhrases } from '../../lib/lensPhrase'
import { layoutLabels } from '../../lib/promptCompose'
import CameraForm from '../camera/CameraForm'
import PromptPreviewPanel from '../camera/PromptPreviewPanel'
import Button from '../common/Button'

interface Props {
  shot: Shot
  film: Film | null
  onNext: () => void
}

export default function StepCamera({ shot, film, onNext }: Props) {
  const { t } = useTranslation()
  const [mappings, setMappings] = useState<PromptMappings | null>(null)
  const [values, setValues] = useState<CameraParamsValues | null>(null)
  const [sceneElements, setSceneElements] = useState<string[]>([])
  const [lens, setLens] = useState<LensData | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    Promise.all([
      getPromptMappings(),
      getCameraParams(shot.id),
      getLayoutState(shot.id),
      getLens(shot.id),
    ])
      .then(([m, v, layout, l]) => {
        setMappings(m)
        setValues(v)
        setSceneElements(layoutLabels(layout.manual_subjects ?? []))
        setLens(l)
      })
      .catch(console.error)
  }, [shot.id])

  const handleChange = (next: CameraParamsValues) => {
    setValues(next)
    setSaveState('dirty')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        await putCameraParams(shot.id, next)
        setSaveState('saved')
      } catch {
        setSaveState('dirty')
      }
    }, 800)
  }

  // Flush pending save when leaving the step.
  const flushAndNext = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (values && saveState !== 'saved') {
      await putCameraParams(shot.id, values)
      setSaveState('saved')
    }
    onNext()
  }

  if (!mappings || !values)
    return <p className="py-16 text-center text-sm text-slate-500">{t('common.loading')}</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-night-700 bg-night-800 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-200">{t('camera.formTitle')}</h3>
            <span
              className={`text-[10px] ${
                saveState === 'saved' ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              {t(`camera.save.${saveState}`)}
            </span>
          </div>
          <CameraForm
            mappings={mappings}
            values={values}
            onChange={handleChange}
            preset={film?.default_camera_params ?? null}
          />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium text-slate-200">{t('camera.previewTitle')}</h3>
          <PromptPreviewPanel
            params={values}
            mappings={mappings}
            sceneElements={sceneElements}
            lensPhrases={lensPhrases(lens, mappings, Boolean(values.camera_move))}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={flushAndNext}>{t('common.next')} →</Button>
      </div>
    </div>
  )
}
