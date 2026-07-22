import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExtractionMeta, Shot } from '../../api/types'
import {
  getAde20k,
  getExtraction,
  getLayoutState,
  putLayoutState,
  type Ade20kAsset,
} from '../../api/endpoints'
import type { LayoutSceneJson, ManualSubject } from '../../lib/layoutScene'
import FramePlayer from '../preview/FramePlayer'
import LassoDrawLayer from '../preview/LassoDrawLayer'
import SubjectPanel from '../preview/SubjectPanel'
import ManualSubjectForm from '../preview/ManualSubjectForm'
import ConfirmDialog from '../common/ConfirmDialog'
import HintBar from '../common/HintBar'
import Button from '../common/Button'

type Palette = 'ade' | 'blockout'

function nextManualId(subjects: ManualSubject[]): string {
  const max = subjects.reduce((m, s) => Math.max(m, parseInt(s.id.slice(1), 10) || 0), 0)
  return `m${max + 1}`
}

interface Props {
  shot: Shot
  onNext: () => void
}

export default function StepPreview({ shot, onNext }: Props) {
  const { t } = useTranslation()
  const [meta, setMeta] = useState<ExtractionMeta | null>(null)
  const [error, setError] = useState('')

  // ---- layout state (single source of truth; persisted here) ----
  const [asset, setAsset] = useState<Ade20kAsset | null>(null)
  const [scene, setScene] = useState<LayoutSceneJson | null>(null)
  const [selected, setSelected] = useState<(number | string)[] | null>(null)
  const [disabledBackdrop, setDisabledBackdrop] = useState<string[]>([])
  const [manualSubjects, setManualSubjects] = useState<ManualSubject[]>([])
  const [palette, setPalette] = useState<Palette>('blockout')

  // ---- interaction state ----
  const [gate, setGate] = useState({ editable: false, canDraw: false })
  const [drawMode, setDrawMode] = useState(false)
  const [selectedManualId, setSelectedManualId] = useState<string | null>(null)
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({
    selected: null as (number | string)[] | null,
    backdrop: [] as string[],
    manual: [] as ManualSubject[],
  })

  useEffect(() => {
    getExtraction(shot.id)
      .then(setMeta)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    getAde20k().then(setAsset).catch(console.error)
    fetch(`/files/${shot.film_id}/shots/${shot.id}/layout/scene.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setScene)
      .catch(console.error)
    getLayoutState(shot.id)
      .then((s) => {
        setSelected(s.selected_instances ?? null)
        setDisabledBackdrop(s.disabled_backdrop ?? [])
        setManualSubjects(s.manual_subjects ?? [])
      })
      .catch(console.error)
  }, [shot.id, shot.film_id])

  useEffect(() => {
    latest.current = { selected, backdrop: disabledBackdrop, manual: manualSubjects }
  }, [selected, disabledBackdrop, manualSubjects])

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(
      () =>
        putLayoutState(shot.id, {
          selected_instances: latest.current.selected,
          disabled_backdrop: latest.current.backdrop,
          manual_subjects: latest.current.manual,
        }).catch(console.error),
      600,
    )
  }, [shot.id])

  // default = show all (detected + manual); an explicit array = curation
  const allIds = useMemo<(number | string)[]>(
    () => [
      ...(scene ? scene.instances.map((i) => i.id) : []),
      ...manualSubjects.map((m) => m.id),
    ],
    [scene, manualSubjects],
  )
  const effSelected = selected ?? allIds
  const disabledInstances = useMemo(
    () => new Set<number | string>(allIds.filter((id) => !effSelected.includes(id))),
    [allIds, effSelected],
  )
  const disabledBackdropSet = useMemo(() => new Set(disabledBackdrop), [disabledBackdrop])

  const toggleSubject = (id: number | string) => {
    const base = selected ?? allIds
    setSelected(base.includes(id) ? base.filter((x) => x !== id) : [...base, id])
    persist()
  }

  const toggleBackdrop = (plane: 'top' | 'bottom') => {
    setDisabledBackdrop((cur) => (cur.includes(plane) ? cur.filter((p) => p !== plane) : [...cur, plane]))
    persist()
  }

  const addManual = (group: string, label: string) => {
    if (!pendingPolygon) return
    const id = nextManualId(manualSubjects)
    setManualSubjects((cur) => [...cur, { id, group, label, polygon: pendingPolygon }])
    // keep it visible if the director is on an explicit selection
    if (selected !== null) setSelected([...selected, id])
    setPendingPolygon(null)
    setDrawMode(false)
    persist()
  }

  const changeManualPolygon = (id: string, polygon: [number, number][]) => {
    setManualSubjects((cur) => cur.map((m) => (m.id === id ? { ...m, polygon } : m)))
    persist()
  }

  const deleteManual = () => {
    const id = deletingId
    if (!id) return
    setManualSubjects((cur) => cur.filter((m) => m.id !== id))
    if (selected !== null) setSelected(selected.filter((x) => x !== id))
    if (selectedManualId === id) setSelectedManualId(null)
    setDeletingId(null)
    persist()
  }

  if (error) return <p className="py-16 text-center text-sm text-red-300">{error}</p>
  if (!meta) return <p className="py-16 text-center text-sm text-slate-500">{t('common.loading')}</p>

  return (
    <div className="flex flex-col gap-4">
      <HintBar text={t('preview.hintBar')} />
      <div className="flex gap-4">
        {/* Player */}
        <div className="min-w-0 flex-1">
          <FramePlayer
            shot={shot}
            meta={meta}
            scene={scene}
            asset={asset}
            manualSubjects={manualSubjects}
            disabledInstances={disabledInstances}
            disabledBackdrop={disabledBackdropSet}
            palette={palette}
            onGate={setGate}
            overlayExtras={
              <LassoDrawLayer
                manualSubjects={manualSubjects}
                pendingPolygon={pendingPolygon}
                interactive={gate.canDraw}
                drawMode={drawMode && !pendingPolygon}
                selectedId={selectedManualId}
                onSelect={setSelectedManualId}
                onDrawn={(polygon) => setPendingPolygon(polygon)}
                onChangePolygon={changeManualPolygon}
              />
            }
          />
        </div>

        {/* Subject panel + inline manual-subject form */}
        <div className="flex shrink-0 flex-col gap-2.5">
          <SubjectPanel
            asset={asset}
            scene={scene}
            effSelected={effSelected}
            manualSubjects={manualSubjects}
            disabledBackdrop={disabledBackdrop}
            editable={gate.editable}
            canDraw={gate.canDraw}
            palette={palette}
            onPaletteChange={setPalette}
            drawMode={drawMode}
            onToggleDraw={() => setDrawMode((v) => !v)}
            selectedManualId={selectedManualId}
            onSelectManual={setSelectedManualId}
            onToggleSubject={toggleSubject}
            onToggleBackdrop={toggleBackdrop}
            onDeleteManual={setDeletingId}
          />
          {!gate.editable && (
            <p className="w-64 text-[11px] leading-relaxed text-amber-400/90">{t('layout.enableHint')}</p>
          )}
          {gate.canDraw && drawMode && !pendingPolygon && (
            <p className="w-64 text-[11px] leading-relaxed text-slate-600">{t('layout.manualHint')}</p>
          )}
          {pendingPolygon && (
            <div className="w-64">
              <ManualSubjectForm
                onSubmit={addManual}
                onCancel={() => {
                  setPendingPolygon(null)
                  setDrawMode(false)
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {meta.output_size[0]}×{meta.output_size[1]} · {meta.frame_count}{' '}
          {t('preview.framesAt', { fps: meta.effective_fps.toFixed(1) })}
        </span>
        <Button onClick={onNext}>{t('common.next')} →</Button>
      </div>

      <ConfirmDialog
        open={deletingId !== null}
        title={t('layout.deleteTitle')}
        message={t('layout.deleteMessage')}
        onConfirm={deleteManual}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  )
}
