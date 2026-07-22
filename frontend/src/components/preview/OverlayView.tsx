import type { ReactNode } from 'react'
import type { Shot } from '../../api/types'
import { frameUrl } from '../../hooks/useFrameUrl'
import type { Ade20kAsset } from '../../api/endpoints'
import type { LayoutSceneJson, ManualSubject } from '../../lib/layoutScene'
import LayoutCanvas from './LayoutCanvas'

interface Props {
  shot: Shot
  index: number
  channels: string[] // overlaid channels
  depthOpacity: number // 0..1
  children?: ReactNode // extra layers (e.g. lasso draw layer)
  // layout overlay (semi-transparent blockout)
  layoutOn: boolean
  layoutOpacity: number
  scene: LayoutSceneJson | null
  asset: Ade20kAsset | null
  manualSubjects: ManualSubject[]
  disabledInstances: Set<number | string>
  disabledBackdrop: Set<string>
}

/**
 * Base frame with control-signal overlays. Pose/canny are black images with
 * bright strokes, so `mix-blend-mode: screen` drops their black background;
 * depth is a full grayscale image and blends via plain opacity. Layout is a
 * canvas blockout drawn from the live scene + manual subjects, blended by opacity.
 */
export default function OverlayView({
  shot,
  index,
  channels,
  depthOpacity,
  children,
  layoutOn,
  layoutOpacity,
  scene,
  asset,
  manualSubjects,
  disabledInstances,
  disabledBackdrop,
}: Props) {
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
      {layoutOn && scene && asset && (
        <LayoutCanvas
          scene={scene}
          asset={asset}
          index={index}
          palette="blockout"
          disabledInstances={disabledInstances}
          disabledBackdrop={disabledBackdrop}
          manualSubjects={manualSubjects}
          className="pointer-events-none absolute inset-0 h-full w-full rounded-lg"
          style={{ opacity: layoutOpacity }}
        />
      )}
      {children}
    </div>
  )
}
