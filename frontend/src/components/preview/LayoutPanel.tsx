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

/** Layout channel panel: the selective 2.5D blockout on a canvas. Only the
 * cinematically salient subjects are marked; the tool proposes the top few
 * (auto) and the director curates the rest. Deselecting one just drops its
 * primitive — the minimal ground/horizon backdrop shows through. */
export default function LayoutPanel({ shot, index }: { shot: Shot; index: number }) {
  const { t } = useTranslation()
  const [asset, setAsset] = useState<Ade20kAsset | null>(null)
  const [scene, setScene] = useState<LayoutSceneJson | null>(null)
  // null = follow the tool's auto proposal; an array = the director's curation.
  const [selected, setSelected] = useState<number[] | null>(null)
  const [disabledBackdrop, setDisabledBackdrop] = useState<string[]>([])
  const [palette, setPalette] = useState<Palette>('blockout')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ selected: null as number[] | null, backdrop: [] as string[] })

  useEffect(() => {
    getAde20k().then(setAsset).catch(console.error)
    fetch(`/files/${shot.film_id}/shots/${shot.id}/layout/scene.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setScene)
      .catch(console.error)
    getLayoutState(shot.id)
      .then((s) => {
        setSelected(s.selected_instances ?? null)
        setDisabledBackdrop(s.disabled_backdrop ?? [])
      })
      .catch(console.error)
  }, [shot.id])

  // Default: every detected subject is shown; the director turns off unwanted.
  const allIds = useMemo(() => (scene ? scene.instances.map((i) => i.id) : []), [scene])
  const effSelected = selected ?? allIds

  useEffect(() => {
    latest.current = { selected, backdrop: disabledBackdrop }
  }, [selected, disabledBackdrop])

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(
      () =>
        putLayoutState(shot.id, {
          selected_instances: latest.current.selected,
          disabled_backdrop: latest.current.backdrop,
        }).catch(console.error),
      600,
    )
  }, [shot.id])

  const toggleSubject = (id: number) => {
    const base = selected ?? allIds
    setSelected(base.includes(id) ? base.filter((x) => x !== id) : [...base, id])
    persist()
  }

  const toggleBackdrop = (plane: 'top' | 'bottom') => {
    setDisabledBackdrop((cur) =>
      cur.includes(plane) ? cur.filter((p) => p !== plane) : [...cur, plane],
    )
    persist()
  }

  // subjects ranked by salience, numbered within their group (Person 1, Car 1…)
  const candidates = useMemo(() => {
    if (!scene) return []
    const counters: Record<string, number> = {}
    return [...scene.instances]
      .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
      .map((inst) => {
        counters[inst.group] = (counters[inst.group] ?? 0) + 1
        return { inst, n: counters[inst.group] }
      })
  }, [scene])

  const disabledInstances = useMemo(
    () => (scene ? scene.instances.map((i) => i.id).filter((id) => !effSelected.includes(id)) : []),
    [scene, effSelected],
  )

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
      new Set(),
      new Set(disabledInstances),
      new Set(disabledBackdrop),
    )
  }, [asset, scene, index, palette, disabledInstances, disabledBackdrop])

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
            {/* minimal backdrop planes: disabled = black (unconstrained) */}
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
          </div>
          {/* subject candidates, ranked by salience; checked = marked */}
          {candidates.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {candidates.map(({ inst, n }) => {
                const on = effSelected.includes(inst.id)
                const [r, g, b] = inst.color ?? asset.blockout_palette[inst.group]
                const pct = Math.round((inst.salience ?? 0) * 100)
                return (
                  <button
                    key={inst.id}
                    onClick={() => toggleSubject(inst.id)}
                    title={t('layout.subjectHint')}
                    className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] transition ${
                      on ? 'border-cyan-500/60 text-slate-200' : 'border-night-800 text-slate-600'
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-[2px]"
                      style={{ background: on ? `rgb(${r},${g},${b})` : '#333' }}
                    />
                    {t(`layout.group.${inst.group}`)} {n}
                    <span className="text-[8px] text-slate-500">{pct}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <span className="px-1 text-[9px] text-slate-600">{t('layout.noSubjects')}</span>
          )}
        </div>
      )}
    </div>
  )
}
