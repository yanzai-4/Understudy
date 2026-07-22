import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Ade20kAsset } from '../../api/endpoints'
import type { LayoutSceneJson, ManualSubject } from '../../lib/layoutScene'

type Palette = 'ade' | 'blockout'

interface Props {
  asset: Ade20kAsset | null
  scene: LayoutSceneJson | null
  effSelected: (number | string)[]
  manualSubjects: ManualSubject[]
  disabledBackdrop: string[]
  editable: boolean
  canDraw: boolean
  palette: Palette
  onPaletteChange: (p: Palette) => void
  drawMode: boolean
  onToggleDraw: () => void
  selectedManualId: string | null
  onSelectManual: (id: string | null) => void
  onToggleSubject: (id: number | string) => void
  onToggleBackdrop: (plane: 'top' | 'bottom') => void
  onDeleteManual: (id: string) => void
}

/** Persistent subject-curation panel beside the viewport (both overlay & split).
 * Presentational: LayoutState lives in the parent (StepPreview). Read-only /
 * dimmed when `editable` is false (overlay mode with the layout channel off). */
export default function SubjectPanel({
  asset,
  scene,
  effSelected,
  manualSubjects,
  disabledBackdrop,
  editable,
  canDraw,
  palette,
  onPaletteChange,
  drawMode,
  onToggleDraw,
  selectedManualId,
  onSelectManual,
  onToggleSubject,
  onToggleBackdrop,
  onDeleteManual,
}: Props) {
  const { t } = useTranslation()

  // detected subjects ranked by salience, numbered within their group
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

  if (!asset || !scene) {
    return (
      <aside className="w-64 shrink-0">
        <p className="py-4 text-center text-[11px] text-slate-600">{t('common.loading')}</p>
      </aside>
    )
  }

  return (
    <aside className={`flex w-64 shrink-0 flex-col gap-2.5 ${editable ? '' : 'pointer-events-none opacity-50'}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">{t('extract.channel.layout')}</span>
        <div className="flex rounded border border-night-600 p-px">
          {(['blockout', 'ade'] as const).map((p) => (
            <button
              key={p}
              onClick={() => onPaletteChange(p)}
              className={`rounded-sm px-1.5 py-0.5 text-[9px] transition ${
                palette === p ? 'bg-night-700 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t(`layout.palette.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* draw region (only meaningful in overlay mode — nothing to trace on in split) */}
      <button
        onClick={onToggleDraw}
        disabled={!canDraw}
        title={canDraw ? t('layout.manualHint') : t('layout.drawOverlayOnly')}
        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
          !canDraw
            ? 'cursor-not-allowed border-night-700 text-slate-600'
            : drawMode
              ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-300'
              : 'border-accent/60 bg-accent/10 text-cyan-300 hover:border-accent hover:bg-accent/20'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M4 20c3-1 5-2 8-6s5-8 8-10c-1 4-3 8-6 11s-7 4-10 5z" />
        </svg>
        {drawMode ? t('layout.drawing') : t('layout.draw')}
      </button>

      {/* backdrop planes */}
      <div className="flex flex-wrap items-center gap-1">
        {(['top', 'bottom'] as const).map((plane) => {
          const off = disabledBackdrop.includes(plane)
          const [r, g, b] = asset.blockout_palette[plane === 'top' ? 'sky' : 'ground']
          return (
            <button
              key={plane}
              onClick={() => onToggleBackdrop(plane)}
              title={t('layout.backdropHint')}
              className={`flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[10px] transition ${
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

      {/* manual subjects (director-drawn) */}
      {manualSubjects.length > 0 && (
        <div className="flex flex-col gap-1">
          {manualSubjects.map((m) => {
            const on = effSelected.includes(m.id)
            const [r, g, b] = asset.blockout_palette[m.group] ?? [140, 140, 140]
            return (
              <div
                key={m.id}
                onClick={() => onSelectManual(m.id === selectedManualId ? null : m.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition ${
                  selectedManualId === m.id ? 'border-cyan-500/50 bg-night-800' : 'border-night-700 bg-night-850 hover:border-night-600'
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleSubject(m.id)
                  }}
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: on ? `rgb(${r},${g},${b})` : '#333' }}
                  title={t('layout.subjectHint')}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">
                  {m.label || t(`layout.group.${m.group}`)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteManual(m.id)
                  }}
                  className="text-slate-600 hover:text-red-300"
                  title={t('common.delete')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* detected subjects */}
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {candidates.map(({ inst, n }) => {
            const on = effSelected.includes(inst.id)
            const [r, g, b] = inst.color ?? asset.blockout_palette[inst.group]
            const pct = Math.round((inst.salience ?? 0) * 100)
            return (
              <button
                key={inst.id}
                onClick={() => onToggleSubject(inst.id)}
                title={t('layout.subjectHint')}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition ${
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
        <span className="px-1 text-[10px] text-slate-600">{t('layout.noSubjects')}</span>
      )}
    </aside>
  )
}
