/**
 * Per-shot wizard position, remembered across sessions (localStorage, which
 * persists in the WebView2 storage profile).
 *
 * We store the *furthest step reached*, so:
 * - leaving mid-flow on step N brings you back to step N, and
 * - once you've reached the final step, going back to tweak something still
 *   returns you to the final step next time.
 *
 * Re-uploading a video clears this (the flow starts over).
 */
const key = (shotId: string) => `understudy.wizard.${shotId}`

export function loadWizardStep(shotId: string): number | null {
  const raw = localStorage.getItem(key(shotId))
  if (raw == null) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

export function saveWizardStep(shotId: string, step: number): void {
  const prev = loadWizardStep(shotId) ?? -1
  if (step > prev) localStorage.setItem(key(shotId), String(step))
}

export function clearWizardStep(shotId: string): void {
  localStorage.removeItem(key(shotId))
}
