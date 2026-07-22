import type { Ade20kAsset } from '../api/endpoints'

/**
 * Client-side renderer for the layout scene proxy.
 * Mirrors backend services/layout_scene.py render_frame() — keep in sync.
 */

export interface SceneInstance {
  id: number
  group: string
  cls: number
  color?: [number, number, number] | null // sampled real-world RGB (identity cue)
  salience?: number // 0..1 cinematic prominence
  auto?: boolean // tool's default selection (the salient few)
  frames: Record<string, number[]> // frame → [x, y, w, h, d]
}

export interface LayoutSceneJson {
  version: number
  size: [number, number]
  frame_count: number
  top_class: number | null
  bottom_class: number | null
  frames: { horizon: number[]; shade: [number, number] }[]
  instances: SceneInstance[]
}

export interface ManualSubject {
  id: string // 'm1', 'm2', … (namespaced vs detected numeric ids)
  group: string // building | props | vehicle | person | animal
  label: string
  polygon: [number, number][] // normalized 0-1, closed region
}

const SHADE_MIN = 0.55
const SHADE_SPAN = 0.45
const MANUAL_DEPTH: Record<string, number> = { building: 0.2 }
const MANUAL_DEPTH_DEFAULT = 0.5

export function groupReprCls(asset: Ade20kAsset, group: string): number | null {
  const idx = asset.groups.indexOf(group)
  return idx >= 0 ? idx : null
}

function classColor(
  asset: Ade20kAsset,
  cls: number | null,
  palette: 'ade' | 'blockout',
  fallbackGroup: string,
): [number, number, number] {
  if (palette === 'ade') {
    const rgb = cls != null ? asset.palette[cls] : [0, 0, 0]
    return [rgb[0], rgb[1], rgb[2]]
  }
  let group = cls != null ? asset.groups[cls] : fallbackGroup
  if (cls != null && asset.classes[cls] === 'ceiling') group = 'building'
  const rgb = asset.blockout_palette[group] ?? asset.blockout_palette[fallbackGroup]
  return [rgb[0], rgb[1], rgb[2]]
}

const css = ([r, g, b]: [number, number, number], f = 1) =>
  `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(1, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: LayoutSceneJson,
  asset: Ade20kAsset,
  frameIndex: number,
  palette: 'ade' | 'blockout',
  disabledGroups: Set<string>,
  disabledInstances: Set<number | string>,
  disabledBackdrop: Set<string> = new Set(),
  manualSubjects: ManualSubject[] = [],
) {
  const [w, h] = scene.size
  const fr = scene.frames[Math.min(frameIndex, scene.frames.length - 1)]
  if (!fr) return

  const topColor = classColor(asset, scene.top_class, palette, 'sky')
  const bottomColor = classColor(asset, scene.bottom_class, palette, 'ground')

  // black base = "no guidance"; disabled backdrop planes stay black (no fill-in)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  if (!disabledBackdrop.has('top')) {
    ctx.fillStyle = css(topColor)
    ctx.fillRect(0, 0, w, h)
  }

  // ground plane under the smoothed horizon polyline
  const pts = fr.horizon
  const step = (w - 1) / (pts.length - 1)
  const groundPath = new Path2D()
  groundPath.moveTo(0, h)
  groundPath.lineTo(0, pts[0])
  pts.forEach((y, i) => groundPath.lineTo(i * step, y))
  groundPath.lineTo(w, h)
  groundPath.closePath()

  const [f0, f1] = fr.shade
  const y0 = pts.reduce((a, b) => a + b, 0) / pts.length
  const rampFill = (color: [number, number, number]) => {
    if (palette !== 'blockout') return css(color)
    const grad = ctx.createLinearGradient(0, y0, 0, h)
    grad.addColorStop(0, css(color, f0))
    grad.addColorStop(1, css(color, f1))
    return grad
  }

  if (disabledBackdrop.has('bottom')) {
    ctx.fillStyle = '#000'
    ctx.fill(groundPath)
  } else {
    ctx.fillStyle = rampFill(bottomColor)
    ctx.fill(groundPath)
  }

  // scenery (nature) behind everything else, then far → near. Manual subjects
  // join the same ordering via a synthetic per-group depth.
  type Renderable =
    | { kind: 'inst'; group: string; d: number; inst: SceneInstance; entry: number[] }
    | { kind: 'poly'; group: string; d: number; subj: ManualSubject }

  const active: Renderable[] = []
  for (const inst of scene.instances) {
    if (disabledInstances.has(inst.id) || disabledGroups.has(inst.group)) continue
    const entry = inst.frames[String(frameIndex)]
    if (entry) active.push({ kind: 'inst', group: inst.group, d: entry[4], inst, entry })
  }
  for (const subj of manualSubjects) {
    if (disabledInstances.has(subj.id) || disabledGroups.has(subj.group)) continue
    active.push({ kind: 'poly', group: subj.group, d: MANUAL_DEPTH[subj.group] ?? MANUAL_DEPTH_DEFAULT, subj })
  }
  active.sort(
    (a, b) => Number(a.group !== 'nature') - Number(b.group !== 'nature') || a.d - b.d,
  )

  for (const r of active) {
    if (r.kind === 'poly') {
      const cls = groupReprCls(asset, r.group)
      const base = classColor(asset, cls, palette, r.group)
      const f = palette === 'blockout' ? SHADE_MIN + SHADE_SPAN * r.d : 1
      const [w0, h0] = scene.size
      ctx.beginPath()
      r.subj.polygon.forEach(([px, py], i) =>
        i === 0 ? ctx.moveTo(px * w0, py * h0) : ctx.lineTo(px * w0, py * h0),
      )
      ctx.closePath()
      ctx.fillStyle = css(base, f)
      ctx.fill()
      continue
    }
    const { inst, entry } = r
    const [x, y, bw, bh, d] = entry
    const base = classColor(asset, inst.cls, palette, inst.group)
    const radius =
      inst.group === 'person'
        ? Math.min(bw, bh) / 2
        : Math.min(bw, bh) *
          (inst.group === 'building' ? 0.06 : inst.group === 'nature' ? 0.35 : 0.15)
    if (palette === 'blockout') {
      const f = SHADE_MIN + SHADE_SPAN * d
      roundRectPath(ctx, x, y, bw, bh, radius)
      ctx.fillStyle = css(base, f * 0.7) // border tone
      ctx.fill()
      if (bw > 8 && bh > 8) {
        roundRectPath(ctx, x + 2, y + 2, bw - 4, bh - 4, radius)
        ctx.fillStyle = css(base, f)
        ctx.fill()
      }
    } else {
      roundRectPath(ctx, x, y, bw, bh, radius)
      ctx.fillStyle = css(base)
      ctx.fill()
    }
  }
}
