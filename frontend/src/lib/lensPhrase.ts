import type { FocusSegment, LensData, PromptMappings } from '../api/types'

/**
 * Mirrors backend services/lens.py lens_phrases() exactly — keep in sync so
 * the live prompt preview matches the exported prompt word for word.
 */

function depthLabel(seg: FocusSegment): string {
  const label = (seg.label ?? '').trim()
  if (label) return label
  if (seg.depth >= 0.66) return 'the foreground subject'
  if (seg.depth <= 0.33) return 'the distant background'
  return 'the mid-ground'
}

export function lensPhrases(
  lens: LensData | null,
  mappings: PromptMappings,
  cameraMoveSet: boolean,
): string[] {
  if (!lens) return []
  const phrases: string[] = []

  const focusSegs = lens.focus.enabled ? [...lens.focus.segments].sort((a, b) => a.start - b.start) : []
  if (lens.focus.enabled && lens.focus.follow_subject) {
    phrases.push('focus following the subject, shallow depth of field')
  } else if (focusSegs.length === 1) {
    phrases.push(`sharp focus on ${depthLabel(focusSegs[0])}`)
  } else if (focusSegs.length >= 2) {
    phrases.push(`rack focus from ${depthLabel(focusSegs[0])} to ${depthLabel(focusSegs[focusSegs.length - 1])}`)
  }

  const focalOptions = new Map(mappings.focal_lengths.map((o) => [o.key, o.fragment]))
  const zoomSegs = lens.zoom.enabled ? [...lens.zoom.segments].sort((a, b) => a.start - b.start) : []
  const focals = zoomSegs.map((s) => s.focal).filter(Boolean)
  const zoomChanges = zoomSegs.length >= 2 && new Set(focals).size >= 2

  if (zoomChanges) {
    if (!cameraMoveSet) {
      phrases.push(`smooth zoom from ${focals[0]} to ${focals[focals.length - 1]}`)
    }
  } else {
    const staticFocal = focals[0] ?? lens.focal
    const fragment = staticFocal ? focalOptions.get(staticFocal) : undefined
    if (fragment) phrases.push(fragment)
  }

  return phrases
}
