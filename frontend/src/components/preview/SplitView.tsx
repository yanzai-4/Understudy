import { useTranslation } from 'react-i18next'
import type { Shot } from '../../api/types'
import { frameUrl } from '../../hooks/useFrameUrl'
import type { Ade20kAsset } from '../../api/endpoints'
import type { LayoutSceneJson, ManualSubject } from '../../lib/layoutScene'
import LayoutCanvas from './LayoutCanvas'

interface Props {
  shot: Shot
  index: number
  channels: string[] // extracted channels
  palette: 'ade' | 'blockout'
  scene: LayoutSceneJson | null
  asset: Ade20kAsset | null
  manualSubjects: ManualSubject[]
  disabledInstances: Set<number | string>
  disabledBackdrop: Set<string>
}

export default function SplitView({
  shot,
  index,
  channels,
  palette,
  scene,
  asset,
  manualSubjects,
  disabledInstances,
  disabledBackdrop,
}: Props) {
  const { t } = useTranslation()
  const panels = ['frames', ...channels]

  return (
    <div
      className={`mx-auto grid max-w-4xl gap-2 ${panels.length > 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
    >
      {panels.map((ch) => (
        <div key={ch} className="relative overflow-hidden rounded-lg border border-night-700">
          {ch === 'layout' ? (
            <LayoutCanvas
              scene={scene}
              asset={asset}
              index={index}
              palette={palette}
              disabledInstances={disabledInstances}
              disabledBackdrop={disabledBackdrop}
              manualSubjects={manualSubjects}
              className="block w-full"
            />
          ) : (
            <img src={frameUrl(shot, ch, index)} alt="" className="block w-full" draggable={false} />
          )}
          <span className="absolute left-2 top-2 rounded bg-night-950/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 backdrop-blur">
            {ch === 'frames' ? t('preview.source') : t(`extract.channel.${ch}`)}
          </span>
        </div>
      ))}
    </div>
  )
}
