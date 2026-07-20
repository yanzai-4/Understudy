import type { FocusKeyframe, LensData, PromptMappings } from '../api/types'

/**
 * Mirrors backend services/lens.py lens_phrases() exactly — keep in sync so
 * the live prompt preview matches the exported prompt word for word.
 */

function depthLabel(kf: FocusKeyframe): string {
  const label = (kf.label ?? '').trim()
  if (label) return label
  if (kf.depth >= 0.66) return 'the foreground subject'
  if (kf.depth <= 0.33) return 'the distant background'
  return 'the mid-ground'
}

export function lensPhrases(
  lens: LensData | null,
  mappings: PromptMappings,
  cameraMoveSet: boolean,
): string[] {
  if (!lens) return []
  const phrases: string[] = []

  const focusKfs = lens.focus.enabled ? [...lens.focus.keyframes].sort((a, b) => a.frame - b.frame) : []
  if (focusKfs.length === 1) {
    phrases.push(`sharp focus on ${depthLabel(focusKfs[0])}`)
  } else if (focusKfs.length >= 2) {
    phrases.push(`rack focus from ${depthLabel(focusKfs[0])} to ${depthLabel(focusKfs[focusKfs.length - 1])}`)
  }

  const focalOptions = new Map(mappings.focal_lengths.map((o) => [o.key, o.fragment]))
  const zoomKfs = lens.zoom.enabled ? [...lens.zoom.keyframes].sort((a, b) => a.frame - b.frame) : []
  const focals = zoomKfs.map((k) => k.focal).filter(Boolean)
  const zoomChanges = zoomKfs.length >= 2 && new Set(focals).size >= 2

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
