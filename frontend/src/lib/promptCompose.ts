import type { CameraParamsValues, PromptMappings } from '../api/types'
import type { ManualSubject } from './layoutScene'

/**
 * Mirrors backend services/prompt_builder.py exactly (ordered fragments joined
 * by ", "). Any change here must be mirrored there.
 */

export interface PromptPart {
  source: string // 'subject' | 'scene' | 'scene_element' | dimension key | 'custom'
  text: string
}

/** Manual-subject labels for the prompt: trimmed, non-empty, de-duped, order kept.
 * Mirrors backend prompt_builder.layout_labels. */
export function layoutLabels(manualSubjects: ManualSubject[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of manualSubjects) {
    const label = (s.label ?? '').trim()
    if (label && !seen.has(label)) {
      seen.add(label)
      out.push(label)
    }
  }
  return out
}

export function composeParts(
  params: CameraParamsValues,
  mappings: PromptMappings,
  lensPhrases: string[] = [],
  sceneElements: string[] = [],
): PromptPart[] {
  const parts: PromptPart[] = []

  const subject = (params.subject_desc ?? '').trim()
  if (subject) parts.push({ source: 'subject', text: subject })
  const scene = (params.scene_desc ?? '').trim()
  if (scene) parts.push({ source: 'scene', text: scene })

  for (const el of sceneElements) parts.push({ source: 'scene_element', text: el })

  for (const phrase of lensPhrases) parts.push({ source: 'lens', text: phrase })

  const dims = [...mappings.dimensions].sort((a, b) => a.order - b.order)
  for (const dim of dims) {
    const selected = params[dim.key as keyof CameraParamsValues]
    if (!selected) continue
    const option = dim.options.find((o) => o.key === selected)
    if (option) parts.push({ source: dim.key, text: option.fragment })
  }

  const custom = (params.custom_positive ?? '').trim()
  if (custom) parts.push({ source: 'custom', text: custom })

  return parts
}

export function composePositive(params: CameraParamsValues, mappings: PromptMappings): string {
  return composeParts(params, mappings)
    .map((p) => p.text)
    .join(', ')
}

export function composeNegative(params: CameraParamsValues, mappings: PromptMappings): string {
  const parts = [mappings.negative_default.trim()]
  const custom = (params.custom_negative ?? '').trim()
  if (custom) parts.push(custom)
  return parts.filter(Boolean).join(', ')
}
