import { useEffect, useRef, type CSSProperties } from 'react'
import type { Ade20kAsset } from '../../api/endpoints'
import { drawScene, type LayoutSceneJson, type ManualSubject } from '../../lib/layoutScene'

interface Props {
  scene: LayoutSceneJson | null
  asset: Ade20kAsset | null
  index: number
  palette: 'ade' | 'blockout'
  disabledInstances: Set<number | string>
  disabledBackdrop: Set<string>
  manualSubjects: ManualSubject[]
  className?: string
  style?: CSSProperties
}

/** Pure display of the layout blockout via drawScene — shared by the overlay
 * layer and the split-view layout cell. State lives in the parent. */
export default function LayoutCanvas({
  scene,
  asset,
  index,
  palette,
  disabledInstances,
  disabledBackdrop,
  manualSubjects,
  className,
  style,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!scene || !asset || !ref.current) return
    const canvas = ref.current
    const [w, h] = scene.size
    canvas.width = w
    canvas.height = h
    drawScene(
      canvas.getContext('2d')!,
      scene,
      asset,
      index,
      palette,
      new Set(),
      disabledInstances,
      disabledBackdrop,
      manualSubjects,
    )
  }, [scene, asset, index, palette, disabledInstances, disabledBackdrop, manualSubjects])

  return <canvas ref={ref} className={className} style={style} />
}
