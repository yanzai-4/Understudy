import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CameraParamsValues, PromptMappings } from '../../api/types'
import { composeNegative, composeParts } from '../../lib/promptCompose'

// Stable color per fragment source so the director can trace each phrase back.
const SOURCE_COLORS: Record<string, string> = {
  subject: 'text-slate-100',
  scene: 'text-slate-300',
  scene_element: 'text-teal-300',
  lens: 'text-indigo-300',
  shot_size: 'text-cyan-300',
  camera_angle: 'text-sky-300',
  camera_move: 'text-blue-300',
  aperture: 'text-fuchsia-300',
  light_position: 'text-amber-300',
  light_quality: 'text-amber-200',
  light_mood: 'text-yellow-300',
  time_ambience: 'text-orange-300',
  weather: 'text-teal-300',
  color_grade: 'text-rose-300',
  style_suffix: 'text-lime-300',
  custom: 'text-slate-200',
}

interface Props {
  params: CameraParamsValues
  mappings: PromptMappings
  /** Manual-subject labels from the layout step, joined into the positive prompt. */
  sceneElements: string[]
  /** Focus/zoom fragments from the lens step (lib/lensPhrase). */
  lensPhrases?: string[]
}

export default function PromptPreviewPanel({ params, mappings, sceneElements, lensPhrases = [] }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'pos' | 'neg' | null>(null)

  const parts = composeParts(params, mappings, lensPhrases, sceneElements)
  const positive = parts.map((p) => p.text).join(', ')
  const negative = composeNegative(params, mappings)
  const wordCount = positive.split(/\s+/).filter(Boolean).length

  const copy = async (text: string, which: 'pos' | 'neg') => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  const block = 'rounded-xl border border-night-700 bg-night-900/70 p-4'

  return (
    <div className="flex flex-col gap-3">
      {/* Positive */}
      <div className={block}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">{t('camera.positive')}</span>
          <div className="flex items-center gap-2 text-[10px] text-slate-600">
            <span>≈ {wordCount} words</span>
            <button
              onClick={() => copy(positive, 'pos')}
              className="rounded border border-night-600 px-2 py-0.5 text-[10px] text-slate-400 transition hover:border-accent hover:text-cyan-300"
            >
              {copied === 'pos' ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>
        {parts.length === 0 ? (
          <p className="text-xs text-slate-600">{t('camera.emptyPrompt')}</p>
        ) : (
          <p className="font-mono text-[13px] leading-relaxed">
            {parts.map((part, i) => (
              <span key={`${part.source}-${i}`} className={SOURCE_COLORS[part.source] ?? 'text-slate-200'}>
                {part.text}
                {i < parts.length - 1 && <span className="text-slate-600">, </span>}
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Negative */}
      <div className={block}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">{t('camera.negative')}</span>
          <button
            onClick={() => copy(negative, 'neg')}
            className="rounded border border-night-600 px-2 py-0.5 text-[10px] text-slate-400 transition hover:border-accent hover:text-cyan-300"
          >
            {copied === 'neg' ? t('common.copied') : t('common.copy')}
          </button>
        </div>
        <p className="font-mono text-[12px] leading-relaxed text-slate-500">{negative}</p>
      </div>
    </div>
  )
}
