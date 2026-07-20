import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Shot } from '../../api/types'
import {
  getBoard,
  listShotsGrouped,
  putBoard,
  updateShot,
  type BoardData,
} from '../../api/endpoints'
import StatusBadge from '../common/StatusBadge'

// ---- geometry constants ----
const CARD_W = 200
const CARD_H = 152
const CARD_GAP = 18
const FRAME_PAD_X = 22
const FRAME_PAD_TOP = 52
const FRAME_PAD_BOTTOM = 20
const FRAME_GAP = 110
const FREE_COL_GAP = 60

const sceneKey = (n: number) => `scene:${n}`

// ---------- custom nodes ----------

const HANDLES: { id: string; pos: Position }[] = [
  { id: 't', pos: Position.Top },
  { id: 'r', pos: Position.Right },
  { id: 'b', pos: Position.Bottom },
  { id: 'l', pos: Position.Left },
]

function ConnectDots() {
  return (
    <>
      {HANDLES.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={h.pos}
          className="!h-2.5 !w-2.5 !rounded-full !border !border-night-950 !bg-cyan-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        />
      ))}
    </>
  )
}

function ShotNode({ data, selected }: NodeProps) {
  const shot = (data as { shot: Shot }).shot
  return (
    <div
      className={`group relative w-[200px] rounded-xl border bg-night-800 shadow-lg shadow-black/30 transition-colors ${
        selected ? 'border-accent' : 'border-night-600 hover:border-night-500'
      }`}
    >
      <ConnectDots />
      <div className="overflow-hidden rounded-t-xl bg-night-900">
        {shot.thumbnail_url ? (
          <img src={shot.thumbnail_url} alt="" draggable={false} className="h-[92px] w-full object-cover" />
        ) : (
          <div className="flex h-[92px] items-center justify-center text-xl opacity-30">🎥</div>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-xs font-medium text-slate-100">{shot.name}</div>
        <div className="mt-1.5 flex items-center gap-1">
          {shot.scene_no != null && (
            <span className="rounded bg-night-700 px-1 py-px text-[9px] font-semibold text-cyan-300">
              S{shot.scene_no}
            </span>
          )}
          <span className="rounded bg-night-700 px-1 py-px text-[9px] font-semibold text-slate-300">
            V{shot.version}
          </span>
          <StatusBadge status={shot.status} />
          {shot.is_picked && <span className="text-[10px] text-amber-400">★</span>}
        </div>
      </div>
    </div>
  )
}

function SceneNode({ data, selected }: NodeProps) {
  const label = (data as { label: string }).label
  return (
    <div
      className={`group h-full w-full rounded-2xl border-2 border-dashed bg-night-900/35 transition-colors ${
        selected ? 'border-accent/70' : 'border-night-600'
      }`}
    >
      <ConnectDots />
      <div className="absolute left-3 top-2.5 rounded-md bg-night-800/90 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">
        {label}
      </div>
    </div>
  )
}

const nodeTypes = { shot: ShotNode, scene: SceneNode }

const EDGE_STYLE = {
  type: 'smoothstep' as const,
  style: { stroke: '#38bdf8', strokeWidth: 1.6, opacity: 0.85 },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8', width: 16, height: 16 },
}

// ---------- graph building ----------

interface SceneInfo {
  no: number
  members: Shot[]
}

function frameSize(memberCount: number) {
  return {
    w: CARD_W + FRAME_PAD_X * 2,
    h: FRAME_PAD_TOP + Math.max(1, memberCount) * (CARD_H + CARD_GAP) - CARD_GAP + FRAME_PAD_BOTTOM,
  }
}

/** Merge the persisted layout with the current shots into React Flow graph. */
function buildGraph(shots: Shot[], saved: BoardData, sceneLabel: (n: number) => string) {
  const scenes: SceneInfo[] = []
  const free: Shot[] = []
  for (const shot of shots) {
    if (shot.scene_no == null) {
      free.push(shot)
    } else {
      let scene = scenes.find((s) => s.no === shot.scene_no)
      if (!scene) {
        scene = { no: shot.scene_no, members: [] }
        scenes.push(scene)
      }
      scene.members.push(shot)
    }
  }
  scenes.sort((a, b) => a.no - b.no)

  // rightmost edge of everything already placed, for appending new items
  let appendX = 0
  for (const geo of Object.values(saved.scenes)) appendX = Math.max(appendX, geo.x + geo.w)
  for (const pos of Object.values(saved.nodes)) {
    if (!pos.parent) appendX = Math.max(appendX, pos.x + CARD_W)
  }

  const nodes: Node[] = []

  for (const scene of scenes) {
    const key = sceneKey(scene.no)
    const need = frameSize(scene.members.length)
    const savedGeo = saved.scenes[key]
    const geo = savedGeo
      ? { x: savedGeo.x, y: savedGeo.y, w: Math.max(savedGeo.w, need.w), h: Math.max(savedGeo.h, need.h) }
      : { x: appendX + (appendX ? FRAME_GAP : 0), y: 0, ...need }
    if (!savedGeo) appendX = geo.x + geo.w

    nodes.push({
      id: key,
      type: 'scene',
      position: { x: geo.x, y: geo.y },
      style: { width: geo.w, height: geo.h },
      data: { label: sceneLabel(scene.no) },
      deletable: false,
      dragHandle: undefined,
      zIndex: 0,
    })

    scene.members.forEach((shot, i) => {
      const savedPos = saved.nodes[shot.id]
      const inThisFrame = savedPos?.parent === key
      nodes.push({
        id: shot.id,
        type: 'shot',
        parentId: key,
        position: inThisFrame
          ? { x: savedPos.x, y: savedPos.y }
          : { x: FRAME_PAD_X, y: FRAME_PAD_TOP + i * (CARD_H + CARD_GAP) },
        data: { shot },
        deletable: false,
        zIndex: 1,
      })
    })
  }

  free.forEach((shot, i) => {
    const savedPos = saved.nodes[shot.id]
    const isFree = savedPos && !savedPos.parent
    nodes.push({
      id: shot.id,
      type: 'shot',
      position: isFree
        ? { x: savedPos.x, y: savedPos.y }
        : { x: appendX + FREE_COL_GAP, y: i * (CARD_H + CARD_GAP) },
      data: { shot },
      deletable: false,
      zIndex: 1,
    })
  })

  const ids = new Set(nodes.map((n) => n.id))
  const edges: Edge[] = (saved.edges ?? [])
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ ...e, ...EDGE_STYLE }))

  return { nodes, edges }
}

function serialize(nodes: Node[], edges: Edge[]): BoardData {
  const data: BoardData = { nodes: {}, scenes: {}, edges: [] }
  for (const node of nodes) {
    if (node.type === 'scene') {
      data.scenes[node.id] = {
        x: node.position.x,
        y: node.position.y,
        w: (node.style?.width as number) ?? CARD_W,
        h: (node.style?.height as number) ?? CARD_H,
      }
    } else {
      data.nodes[node.id] = {
        x: node.position.x,
        y: node.position.y,
        ...(node.parentId ? { parent: node.parentId } : {}),
      }
    }
  }
  data.edges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }))
  return data
}

/** Deterministic tidy layout: frames left→right by scene number, shots stacked. */
function autoLayout(nodes: Node[]): Node[] {
  const frames = nodes
    .filter((n) => n.type === 'scene')
    .sort((a, b) => parseInt(a.id.slice(6), 10) - parseInt(b.id.slice(6), 10))
  const result: Node[] = []
  let x = 0

  for (const frame of frames) {
    const members = nodes.filter((n) => n.parentId === frame.id)
    const size = frameSize(members.length)
    result.push({ ...frame, position: { x, y: 0 }, style: { width: size.w, height: size.h } })
    members
      .sort((a, b) => {
        const sa = (a.data as { shot: Shot }).shot
        const sb = (b.data as { shot: Shot }).shot
        return sa.version - sb.version || sa.created_at.localeCompare(sb.created_at)
      })
      .forEach((m, i) => {
        result.push({ ...m, position: { x: FRAME_PAD_X, y: FRAME_PAD_TOP + i * (CARD_H + CARD_GAP) } })
      })
    x += size.w + FRAME_GAP
  }

  const freeShots = nodes.filter((n) => n.type === 'shot' && !n.parentId)
  freeShots.forEach((m, i) => {
    result.push({ ...m, position: { x: x + (x ? 0 : FREE_COL_GAP), y: i * (CARD_H + CARD_GAP) } })
  })
  return result
}

// ---------- component ----------

interface Props {
  filmId: string
  /** Notify the page that a shot's scene changed via drag (storyboard is stale). */
  onShotsChanged: () => void
}

function FilmBoardInner({ filmId, onShotsChanged }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { fitView } = useReactFlow()
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const loaded = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // load shots + persisted board, merge; every open starts tidy (auto-layout),
  // while connections and scene membership come from the saved state / DB
  useEffect(() => {
    loaded.current = false
    Promise.all([listShotsGrouped(filmId, {}), getBoard(filmId)])
      .then(([grouped, saved]) => {
        const shots = grouped.groups.flatMap((g) => g.shots)
        const graph = buildGraph(shots, saved, (n) => t('shots.sceneN', { n }))
        setNodes(autoLayout(graph.nodes))
        setEdges(graph.edges)
        loaded.current = true
      })
      .catch(console.error)
  }, [filmId]) // eslint-disable-line react-hooks/exhaustive-deps

  // debounced persistence of positions + connections
  const scheduleSave = useCallback(
    (ns: Node[], es: Edge[]) => {
      if (!loaded.current) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        putBoard(filmId, serialize(ns, es)).catch(console.error)
      }, 800)
    },
    [filmId],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((ns) => {
        const next = applyNodeChanges(changes, ns)
        if (changes.some((c) => c.type === 'position' && !c.dragging)) {
          setEdges((es) => {
            scheduleSave(next, es)
            return es
          })
        }
        return next
      }),
    [scheduleSave],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((es) => {
        const next = applyEdgeChanges(changes, es)
        setNodes((ns) => {
          scheduleSave(ns, next)
          return ns
        })
        return next
      }),
    [scheduleSave],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source === conn.target) return
      setEdges((es) => {
        const next = addEdge({ ...conn, id: `e-${conn.source}-${conn.target}-${Date.now()}`, ...EDGE_STYLE }, es)
        setNodes((ns) => {
          scheduleSave(ns, next)
          return ns
        })
        return next
      })
    },
    [scheduleSave],
  )

  /** Drag-to-reassign: dropping a card inside another frame (or outside all
   * frames) updates the shot's scene_no in the database. */
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      if (node.type !== 'shot') return
      setNodes((ns) => {
        const frames = ns.filter((n) => n.type === 'scene')
        const parent = node.parentId ? ns.find((n) => n.id === node.parentId) : undefined
        const absX = node.position.x + (parent?.position.x ?? 0)
        const absY = node.position.y + (parent?.position.y ?? 0)
        const cx = absX + CARD_W / 2
        const cy = absY + CARD_H / 2

        const hit = frames.find((f) => {
          const w = (f.style?.width as number) ?? 0
          const h = (f.style?.height as number) ?? 0
          return cx >= f.position.x && cx <= f.position.x + w && cy >= f.position.y && cy <= f.position.y + h
        })

        const newParent = hit?.id
        if (newParent === node.parentId) return ns

        const next = ns.map((n) => {
          if (n.id !== node.id) return n
          const rel = hit
            ? { x: absX - hit.position.x, y: absY - hit.position.y }
            : { x: absX, y: absY }
          const shot = (n.data as { shot: Shot }).shot
          const newSceneNo = hit ? parseInt(hit.id.slice(6), 10) : null
          return {
            ...n,
            parentId: newParent,
            position: rel,
            data: { shot: { ...shot, scene_no: newSceneNo } },
          }
        })

        // parents must precede children in the array
        next.sort((a, b) => (a.type === 'scene' ? 0 : 1) - (b.type === 'scene' ? 0 : 1))

        const newSceneNo = hit ? parseInt(hit.id.slice(6), 10) : null
        updateShot(node.id, newSceneNo == null ? { clear_scene_no: true } : { scene_no: newSceneNo })
          .then(onShotsChanged)
          .catch(console.error)

        setEdges((es) => {
          scheduleSave(next, es)
          return es
        })
        return next
      })
    },
    [scheduleSave, onShotsChanged],
  )

  const handleAutoLayout = useCallback(() => {
    setNodes((ns) => {
      const next = autoLayout(ns)
      setEdges((es) => {
        scheduleSave(next, es)
        return es
      })
      setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50)
      return next
    })
  }, [scheduleSave, fitView])

  const defaultViewport = useMemo(() => ({ x: 40, y: 40, zoom: 0.8 }), [])

  return (
    <div className="h-[calc(100vh-240px)] min-h-[420px] overflow-hidden rounded-xl border border-night-700 bg-night-950/60">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_e, node) => node.type === 'shot' && navigate(`/shots/${node.id}`)}
        onEdgeDoubleClick={(_e, edge) =>
          setEdges((es) => {
            const next = es.filter((x) => x.id !== edge.id)
            setNodes((ns) => {
              scheduleSave(ns, next)
              return ns
            })
            return next
          })
        }
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        snapToGrid
        snapGrid={[16, 16]}
        minZoom={0.15}
        maxZoom={1.75}
        defaultViewport={defaultViewport}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        deleteKeyCode={['Delete', 'Backspace']}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#1c2a4a" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          bgColor="#0a1020"
          nodeColor={(n) => (n.type === 'scene' ? '#131d33' : '#2b3d66')}
          nodeStrokeColor={() => '#3d5288'}
          maskColor="rgba(4, 7, 14, 0.7)"
        />
        <Panel position="top-left" className="flex items-center gap-2">
          <button
            onClick={handleAutoLayout}
            className="rounded-lg border border-night-600 bg-night-900/90 px-3 py-1.5 text-xs text-slate-300 backdrop-blur transition hover:border-accent hover:text-cyan-300"
          >
            {t('board.autoLayout')}
          </button>
          <span className="hidden rounded-lg bg-night-900/70 px-2.5 py-1.5 text-[10px] text-slate-500 backdrop-blur lg:block">
            {t('board.hint')}
          </span>
        </Panel>
      </ReactFlow>
    </div>
  )
}

export default function FilmBoard(props: Props) {
  return (
    <ReactFlowProvider>
      <FilmBoardInner {...props} />
    </ReactFlowProvider>
  )
}
