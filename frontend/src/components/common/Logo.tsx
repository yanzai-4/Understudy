interface Props {
  size?: number
  /** true = app-icon style with the rounded night tile; false = bare glyph */
  tile?: boolean
  className?: string
  /** id prefix so multiple instances don't collide on gradient defs */
  idPrefix?: string
}

/**
 * The Understudy mark: the letter U drawn as an OpenPose-style bone chain —
 * three keypoint joints connected by a cyan→blue stroke, framed by viewfinder
 * brackets. Geometry mirrors scripts/launcher/make_icon.py.
 */
export default function Logo({ size = 28, tile = false, className = '', idPrefix = 'lg' }: Props) {
  const grad = `${idPrefix}-stroke`
  const bg = `${idPrefix}-bg`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={grad} x1="18" y1="18" x2="46" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#3f7bf6" />
        </linearGradient>
        {tile && (
          <linearGradient id={bg} x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0c1526" />
            <stop offset="1" stopColor="#16233f" />
          </linearGradient>
        )}
      </defs>

      {tile && <rect width="64" height="64" rx="14" fill={`url(#${bg})`} />}

      {/* viewfinder brackets */}
      <g
        className="logo-brackets"
        stroke={tile ? '#3a5488' : '#2b3d66'}
        strokeWidth="2.1"
        strokeLinecap="round"
      >
        <path d="M9 18v-5.5a3.5 3.5 0 0 1 3.5-3.5H18" />
        <path d="M46 9h5.5A3.5 3.5 0 0 1 55 12.5V18" />
        <path d="M55 46v5.5a3.5 3.5 0 0 1-3.5 3.5H46" />
        <path d="M18 55h-5.5A3.5 3.5 0 0 1 9 51.5V46" />
      </g>

      {/* the bone: U */}
      <path
        className="logo-bone"
        d="M22.5 21 V33.5 A9.5 9.5 0 0 0 41.5 33.5 V21"
        stroke={`url(#${grad})`}
        strokeWidth="5.6"
        strokeLinecap="round"
        pathLength="100"
      />

      {/* keypoint joints */}
      {[
        [22.5, 21],
        [41.5, 21],
        [32, 43],
      ].map(([x, y], i) => (
        <g key={i} className={`logo-joint logo-joint-${i}`}>
          <circle cx={x} cy={y} r="4.4" fill="#38bdf8" opacity="0.35" />
          <circle cx={x} cy={y} r="2.8" fill="#eaf7ff" />
        </g>
      ))}
    </svg>
  )
}
