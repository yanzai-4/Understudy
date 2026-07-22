import type { ReactNode } from 'react'
import type { Shot } from '../../api/types'
import { frameUrl } from '../../hooks/useFrameUrl'

interface Props {
  shot: Shot
  index: number
  channels: string[] // overlaid channels
  depthOpacity: number // 0..1
  children?: ReactNode // extra layers (e.g. box-draw canvas)
}

/**
 * Base frame with control-signal overlays. Pose/canny are black images with
 * bright strokes, so `mix-blend-mode: screen` drops their black background;
 * depth is a full grayscale image and blends via plain opacity instead.
 */
export default function OverlayView({ shot, index, channels, depthOpacity, children }: Props) {
  return (
    <div className="relative mx-auto w-fit">
      <img
        src={frameUrl(shot, 'frames', index)}
        alt=""
        className="block max-h-[60vh] rounded-lg"
        draggable={false}
      />
      {channels.includes('depth') && (
        <img
          src={frameUrl(shot, 'depth', index)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full rounded-lg"
          style={{ opacity: depthOpacity }}
        />
      )}
      {channels.includes('pose') && (
        <img
          src={frameUrl(shot, 'pose', index)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full rounded-lg"
          style={{ mixBlendMode: 'screen' }}
        />
      )}
      {children}
    </div>
  )
}
