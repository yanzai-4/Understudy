import i18n from '../i18n'

/** Relative "x minutes/hours/days ago" in the active UI language. */
export function relativeTime(iso: string): string {
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z').getTime()
  const diffSec = (then - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(i18n.language === 'zh' ? 'zh-CN' : 'en', {
    numeric: 'auto',
  })
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day')
  return new Date(then).toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en')
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`
}

/** Human-friendly time estimate: seconds under 1min, min+sec up to 30min,
 * minutes up to 1h, hours beyond. */
export function formatEstimate(sec: number, lang: string): string {
  const zh = lang !== 'en'
  if (sec < 60) return zh ? `${sec} 秒` : `${sec}s`
  if (sec < 1800) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    if (s === 0) return zh ? `${m} 分` : `${m}min`
    return zh ? `${m} 分 ${s} 秒` : `${m}m${s}s`
  }
  if (sec < 3600) return zh ? `${Math.round(sec / 60)} 分` : `${Math.round(sec / 60)}min`
  return zh ? `${Math.round(sec / 3600)} 小时` : `${Math.round(sec / 3600)}h`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
