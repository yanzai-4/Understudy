import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Logo from './Logo'

const SEEN_KEY = 'understudy.splashed'
const TICKS = 17 // editing-timeline ruler under the wordmark

/**
 * ~2.2s opening title: viewfinder brackets settle, the U-skeleton draws itself
 * bone-by-bone, keypoints pop in, the wordmark tracks into place, and a
 * playhead sweeps a timeline ruler — then the whole card fades into the app.
 * Plays once per launch (session); honors prefers-reduced-motion.
 */
export default function SplashScreen() {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'show' | 'out' | 'done'>(() => {
    const skip =
      sessionStorage.getItem(SEEN_KEY) ||
      new URLSearchParams(window.location.search).has('nosplash')
    return skip ? 'done' : 'show'
  })

  useEffect(() => {
    if (phase !== 'show') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const hold = reduced ? 900 : 1900
    const t1 = setTimeout(() => setPhase('out'), hold)
    const t2 = setTimeout(() => {
      sessionStorage.setItem(SEEN_KEY, '1')
      setPhase('done')
    }, hold + 450)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [phase])

  if (phase === 'done') return null

  return (
    <div className={`splash ${phase === 'out' ? 'splash-out' : ''}`} aria-hidden="true">
      <div className="flex flex-col items-center">
        <Logo size={92} tile idPrefix="splash" />
        <div className="splash-wordmark mt-5 text-[26px] font-semibold text-slate-100">
          Under<span className="text-cyan-400">study</span>
        </div>
        <div className="splash-tagline mt-1 text-xs text-slate-500">{t('app.tagline')}</div>

        {/* timeline ruler + playhead */}
        <div className="splash-ruler relative mt-6 h-4 w-56">
          {Array.from({ length: TICKS }, (_, i) => (
            <span
              key={i}
              className="splash-tick absolute bottom-0 w-px bg-night-500"
              style={{
                left: `${(i / (TICKS - 1)) * 100}%`,
                height: i % 4 === 0 ? '10px' : '5px',
                ['--i' as string]: i,
              }}
            />
          ))}
          <span className="splash-playhead absolute bottom-0 h-full w-px bg-cyan-300" />
        </div>
      </div>
    </div>
  )
}
