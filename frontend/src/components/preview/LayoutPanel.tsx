import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Shot } from '../../api/types'
import {
  getAde20k,
  getLayoutState,
  putLayoutState,
  type Ade20kAsset,
} from '../../api/endpoints'
import { drawScene, type LayoutSceneJson } from '../../lib/layoutScene'

type Palette = 'ade' | 'blockout'

/** Layout channel panel: the 2.5D scene proxy rendered on a canvas.
 * Every person/vehicle/building is a tracked instance you can toggle off —
 * the always-complete backdrop fills in behind it (never a hole). */
export default function LayoutPanel({ shot, index }: { shot: Shot; index: number }) {
  const { t } = useTranslation()
  const [asset, setAsset] = useState<Ade20kAsset | null>(null)
  const [scene, setScene] = useState<LayoutSceneJson | null>(null)
  const [disabledGroups, setDisabledGroups] = useState<string[]>([])
  const [disabledInstances, setDisabledInstances] = useState<number[]>([])
  const [disabledBackdrop, setDisabledBackdrop] = useState<string[]>([])
  const [palette, setPalette] = useState<Palette>('blockout')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Debounced saves read the latest state from this ref, so rapid mixed
  // group/instance toggles can't overwrite each other with stale closures.
  const latest = useRef({ groups: [] as string[], instances: [] as number[], backdrop: [] as string[] })

  useEffect(() => {
    getAde20k().then(setAsset).catch(console.error)
    fetch(`/files/${shot.film_id}/shots/${shot.id}/layout/scene.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setScene)
      .catch(console.error)
    getLayoutState(shot.id)
      .then((s) => {
        setDisabledGroups(s.disabled_groups)
        setDisabledInstances(s.disabled_instances ?? [])
        setDisabledBackdrop(s.disabled_backdrop ?? [])
      })
      .catch(console.error)
  }, [shot.id])

  useEffect(() => {
    latest.current = { groups: disabledGroups, instances: disabledInstances, backdrop: disabledBackdrop }
  }, [disabledGroups, disabledInstances, disabledBackdrop])

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(
      () =>
        putLayoutState(shot.id, {
          disabled_groups: latest.current.groups,
          disabled_instances: latest.current.instances,
          disabled_backdrop: latest.current.backdrop,
        }).catch(console.error),
      600,
    )
  }, [shot.id])

  const toggleGroup = (group: string) => {
    setDisabledGroups((cur) =>
      cur.includes(group) ? cur.filter((g) => g !== group) : [...cur, group],
    )
    persist()
  }

  const toggleInstance = (id: number) => {
    setDisabledInstances((cur) => (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]))
    persist()
  }

  const toggleBackdrop = (plane: 'top' | 'bottom') => {
    setDisabledBackdrop((cur) =>
      cur.includes(plane) ? cur.filter((p) => p !== plane) : [...cur, plane],
    )
    persist()
  }

  // number instances within their group: Person 1, Person 2, Car 1...
  const labeled = useMemo(() => {
    if (!scene) return []
    const counters: Record<string, number> = {}
    return scene.instances.map((inst) => {
      counters[inst.group] = (counters[inst.group] ?? 0) + 1
      return { inst, n: counters[inst.group] }
    })
  }, [scene])

  useEffect(() => {
    if (!asset || !scene || !canvasRef.current) return
    const canvas = canvasRef.current
    const [w, h] = scene.size
    canvas.width = w
    canvas.height = h
    drawScene(
      canvas.getContext('2d')!,
      scene,
      asset,
      index,
      palette,
      new Set(disabledGroups),
      new Set(disabledInstances),
      new Set(disabledBackdrop),
    )
  }, [asset, scene, index, palette, disabledGroups, disabledInstances, disabledBackdrop])

  const groupsPresent = useMemo(
    () => (scene ? [...new Set(scene.instances.map((i) => i.group))] : []),
    [scene],
  )

  return (
    <div>
      <canvas ref={canvasRef} className="block w-full" />
      {asset && scene && (
        <div className="flex flex-col gap-1 bg-night-950/70 px-1.5 py-1">
          <div className="flex flex-wrap items-center gap-1">
            <div className="mr-1 flex rounded border border-night-600 p-px">
              {(['blockout', 'ade'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPalette(p)}
                  className={`rounded-sm px-1.5 py-0.5 text-[9px] transition ${
                    palette === p ? 'bg-night-700 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t(`layout.palette.${p}`)}
                </button>
              ))}
            </div>
            {/* backdrop planes: disabled = black (unconstrained), never backfilled */}
            {(['top', 'bottom'] as const).map((plane) => {
              const off = disabledBackdrop.includes(plane)
              const [r, g, b] = asset.blockout_palette[plane === 'top' ? 'sky' : 'ground']
              return (
                <button
                  key={plane}
                  onClick={() => toggleBackdrop(plane)}
                  title={t('layout.backdropHint')}
                  className={`flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[9px] transition ${
                    off ? 'border-night-700 text-slate-600 line-through' : 'border-night-500 text-slate-300'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-[2px]"
                    style={{ background: off ? '#111' : `rgb(${r},${g},${b})` }}
                  />
                  {t(`layout.backdrop.${plane}`)}
                </button>
              )
            })}
            {groupsPresent.map((group) => {
              const off = disabledGroups.includes(group)
              const [r, g, b] = asset.blockout_palette[group]
              return (
                <button
                  key={group}
                  onClick={() => toggleGroup(group)}
                  title={t('layout.toggleHint')}
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] transition ${
                    off ? 'border-night-700 text-slate-600 line-through' : 'border-night-500 text-slate-300'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: off ? '#333' : `rgb(${r},${g},${b})` }}
                  />
                  {t(`layout.group.${group}`)}
                </button>
              )
            })}
          </div>
          {/* per-instance toggles */}
          {labeled.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {labeled.map(({ inst, n }) => {
                const groupOff = disabledGroups.includes(inst.group)
                const off = groupOff || disabledInstances.includes(inst.id)
                // real sampled color when available — tells you WHICH person/car this is
                const [r, g, b] = inst.color ?? asset.blockout_palette[inst.group]
                return (
                  <button
                    key={inst.id}
                    disabled={groupOff}
                    onClick={() => toggleInstance(inst.id)}
                    title={t('layout.instanceHint')}
                    className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] transition disabled:opacity-40 ${
                      off ? 'border-night-800 text-slate-600 line-through' : 'border-night-600 text-slate-400'
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-[2px]"
                      style={{ background: off ? '#333' : `rgb(${r},${g},${b})` }}
                    />
                    {t(`layout.group.${inst.group}`)} {n}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
