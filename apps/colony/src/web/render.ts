import { type Edge, HEADER_UNITS, type SymbolKind, type WorldNode } from '../shared/world-types.ts'
import type { Camera, Viewport } from './camera.ts'
import type { FrameLane, LaneLayer } from './lane-layer.ts'
import { MIN_LINK_ALPHA } from './link-cache.ts'
import { fade, GRID_FADE, LABEL_FONT, MIN_VISIBLE_PX, openness } from './lod.ts'
import { OVERLAYS, type OverlayId } from './overlays.ts'
import type { Scene } from './scene.ts'

// Draws one frame: the unit grid, flat blocks (fill plus a 1px border), the
// overlays' lanes, labels, then outlines. World coordinates are grid units,
// and block edges are rounded to pixels the same way as grid lines, so every
// edge sits on a grid line.

export interface Drawn {
  node: WorldNode
  x: number
  y: number
  w: number
  h: number
  alpha: number
}

export interface RenderState {
  selected: string | undefined
  // The hovered node, else the selected one: its connections stand out.
  focus: string | undefined
  // The focus and everything inside it.
  focusSubtree: ReadonlySet<string>
  overlays: ReadonlySet<OverlayId>
  // Routes the Dependency overlay's lanes; without it none are drawn.
  lanes?: LaneLayer
}

const BACKGROUND = '#0d1b2a'
const GRID = '#1b3149'
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'

export const SYMBOL_COLORS: Record<SymbolKind, string> = {
  function: '#7cc6f2',
  method: '#93d3c9',
  class: '#f2b45c',
  interface: '#c4a7ff',
  type: '#dba6e0',
  enum: '#f2877f',
  variable: '#a9b98b',
  namespace: '#86b0a2',
}

export const EDGE_COLORS: Record<Edge['kind'], string> = {
  import: '#6aa8ff',
  call: '#4fd6c4',
  http: '#f2a33a',
  queue: '#b48cff',
  data: '#ef6f6c',
}

interface Label {
  text: string
  x: number
  y: number
  size: number
  alpha: number
  maxWidth: number
  align: CanvasTextAlign
  color: string
  weight: number
}

export function render(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  view: Viewport,
  state: RenderState,
): Drawn[] {
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, view.width, view.height)
  drawGrid(ctx, camera, view)

  const drawn: Drawn[] = []
  const labels: Label[] = []
  const visit = (node: WorldNode, alpha: number) => {
    const [x, y] = camera.toScreen(node.rect.x, node.rect.y)
    const w = node.rect.w * camera.scale
    const h = node.rect.h * camera.scale
    if (x > view.width || y > view.height || x + w < 0 || y + h < 0) return
    const side = Math.min(w, h)
    if (node.kind !== 'world' && side < MIN_VISIBLE_PX) return
    const kids = scene.children.get(node.id)
    const open = kids ? openness(node.kind, side) : 0
    const item = { node, x, y, w, h, alpha }
    if (node.kind !== 'world') {
      drawBody(ctx, item, open, labels, camera.scale)
      drawn.push(item)
    }
    if (open > 0.01 && kids) for (const kid of kids) visit(kid, alpha * open)
  }
  if (scene.root) visit(scene.root, 1)

  const holders = drawn.filter((item) => item.alpha >= MIN_LINK_ALPHA)
  const frame = state.lanes?.frame(
    camera.scale,
    holders,
    state.focus,
    state.focusSubtree,
    state.overlays.has('dependency'),
  )
  if (frame) drawLanes(ctx, frame.lanes, camera, view)
  drawLabels(ctx, labels)
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  // The nodes at the other end of the focus's imports, then the focus.
  if (frame && frame.partners.size > 0) {
    ctx.strokeStyle = DEPENDENCY_COLOR
    ctx.lineWidth = 1.5
    for (const item of drawn) if (frame.partners.has(item.node.id)) outline(ctx, item, 1)
  }
  const focus = state.focus !== state.selected && drawn.find((d) => d.node.id === state.focus)
  if (focus) {
    ctx.strokeStyle = 'rgba(228, 237, 246, 0.85)'
    ctx.lineWidth = 1.5
    outline(ctx, focus, 1)
  }
  const selected = drawn.find((d) => d.node.id === state.selected)
  if (selected) {
    ctx.strokeStyle = '#ffd166'
    ctx.lineWidth = 2
    outline(ctx, selected, 0.5)
  }
  return drawn
}

const DEPENDENCY_COLOR = OVERLAYS[0].color

// A line just outside a drawn node's border.
function outline(ctx: CanvasRenderingContext2D, item: Drawn, inset: number): void {
  const { x0, y0, x1, y1 } = snap(item)
  ctx.strokeRect(x0 - inset, y0 - inset, x1 - x0 + 2 * inset + 1, y1 - y0 + 2 * inset + 1)
}

// One line per grid unit, the unit every layout size is a whole number of.
// The lines fade out when they get too dense to read.
function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, view: Viewport): void {
  const alpha = fade(camera.scale, GRID_FADE)
  if (alpha <= 0) return
  ctx.globalAlpha = alpha
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1
  ctx.beginPath()
  const [wx, wy] = camera.toWorld(0, 0)
  for (let gx = Math.floor(wx); ; gx++) {
    const [sx] = camera.toScreen(gx, 0)
    if (sx > view.width) break
    ctx.moveTo(Math.round(sx) + 0.5, 0)
    ctx.lineTo(Math.round(sx) + 0.5, view.height)
  }
  for (let gy = Math.floor(wy); ; gy++) {
    const [, sy] = camera.toScreen(0, gy)
    if (sy > view.height) break
    ctx.moveTo(0, Math.round(sy) + 0.5)
    ctx.lineTo(view.width, Math.round(sy) + 0.5)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

// A drawn rectangle's edges, rounded to pixels like the grid lines.
function snap({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return {
    x0: Math.round(x),
    y0: Math.round(y),
    x1: Math.round(x + w),
    y1: Math.round(y + h),
  }
}

// Fills the snapped rectangle and strokes its border on the pixel rows and
// columns of its edges, where the grid lines are.
function drawBlock(
  ctx: CanvasRenderingContext2D,
  item: Drawn,
  fill: string,
  border: string | undefined,
): void {
  const { x0, y0, x1, y1 } = snap(item)
  ctx.fillStyle = fill
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  if (!border) return
  ctx.strokeStyle = border
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0)
}

const hues = new Map<string, number>()
// A stable hue per module, so a module's files share a colour and
// neighbouring modules tell apart at every zoom.
export function hueOf(node: WorldNode): number {
  const key = (node.kind === 'file' ? node.parent : undefined) ?? node.id
  let hue = hues.get(key)
  if (hue === undefined) {
    let hash = 2166136261
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
    hue = (hash >>> 0) % 360
    hues.set(key, hue)
  }
  return hue
}

function isTest(node: WorldNode): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\.[^/]+$/.test(node.path ?? '')
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  item: Drawn,
  open: number,
  labels: Label[],
  unit: number,
): void {
  const { node, x, y, w, h, alpha } = item
  ctx.setLineDash([])
  ctx.lineWidth = 1
  const closed = 1 - open
  if (node.kind === 'symbol') {
    ctx.globalAlpha = alpha * 0.9
    ctx.fillStyle = SYMBOL_COLORS[node.symbolKind ?? 'function']
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = alpha
    ctx.strokeStyle = 'rgba(13, 27, 42, 0.8)'
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    const size = Math.min(12, h * 0.7)
    labels.push({
      text: node.name,
      x: x + 4,
      y: y + Math.min(h, size * 1.6) / 2,
      size,
      alpha: alpha * fade(size, LABEL_FONT),
      maxWidth: w - 8,
      align: 'left',
      color: '#0d1b2a',
      weight: 600,
    })
    return
  }

  const hue = hueOf(node)
  const sat = isTest(node) ? 12 : 42
  ctx.globalAlpha = alpha
  if (node.kind === 'project') {
    // Only a label: the repositories inside carry the outlines.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.015)'
    const { x0, y0, x1, y1 } = snap(item)
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  } else if (node.kind === 'repo') {
    drawBlock(ctx, item, `rgba(16, 34, 53, ${0.6 + 0.4 * closed})`, '#3e6289')
  } else if (node.kind === 'package') {
    // A tinted band with no outline.
    drawBlock(ctx, item, `hsla(${hue}, 30%, 45%, ${0.08 + 0.3 * closed})`, undefined)
  } else if (node.kind === 'module') {
    drawBlock(ctx, item, `hsl(212, 38%, ${14 + 6 * closed}%)`, `hsl(${hue}, 25%, 36%)`)
  } else if (node.kind === 'file') {
    const light = node.language === 'text' || node.language === 'binary' ? 30 : 44
    drawBlock(
      ctx,
      item,
      `hsl(${hue}, ${node.language === 'text' ? 8 : sat + 10}%, ${light - 16 * open}%)`,
      'rgba(13, 27, 42, 0.9)',
    )
  }

  // Closed: name in the middle. Open: name in the header strip.
  const name =
    node.kind === 'project' || node.kind === 'package' ? node.name.toUpperCase() : node.name
  const centred = Math.min(16, w / Math.max(name.length * 0.62, 1), h * 0.4)
  if (closed > 0.01) {
    labels.push({
      text: name,
      x: x + w / 2,
      y: y + h / 2,
      size: centred,
      alpha: alpha * closed * fade(centred, LABEL_FONT),
      maxWidth: w - 4,
      align: 'center',
      color: '#e4edf6',
      weight: node.kind === 'file' ? 400 : 600,
    })
  }
  if (open > 0.01) {
    let size: number
    let inset: number
    let middle: number
    if (node.kind === 'file') {
      size = Math.min(12, 0.08 * Math.min(w, h) * 0.8)
      inset = 0.08 * Math.min(w, h)
      middle = y + inset / 2
    } else {
      const header = HEADER_UNITS[node.kind] * unit
      size = Math.min(13, (node.kind === 'module' ? 0.85 : 0.6) * header)
      inset = Math.min(unit * 0.5, 10)
      middle = y + header / 2
    }
    labels.push({
      text: name,
      x: x + inset,
      y: middle,
      size,
      alpha: alpha * open * fade(size, LABEL_FONT),
      maxWidth: w - 2 * inset,
      align: 'left',
      color:
        node.kind === 'package'
          ? `hsl(${hue}, 30%, 72%)`
          : node.kind === 'project'
            ? '#9db8d6'
            : '#dbe7f3',
      weight: 600,
    })
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, labels: Label[]): void {
  ctx.textBaseline = 'middle'
  for (const label of labels) {
    if (label.alpha <= 0.02 || label.maxWidth < 8) continue
    ctx.globalAlpha = label.alpha
    ctx.font = `${label.weight} ${label.size.toFixed(1)}px ${FONT}`
    ctx.fillStyle = label.color
    ctx.textAlign = label.align
    ctx.fillText(ellipsize(ctx, label.text, label.maxWidth), label.x, label.y)
  }
  ctx.globalAlpha = 1
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? '' : `${text.slice(0, lo)}…`
}

// Lanes sit one grid unit apart, so lines and arrowheads scale with the unit
// up to these sizes, in pixels.
const LANE_WIDTH_PX: readonly [number, number] = [0.75, 2]
const ARROW_PX: readonly [number, number] = [3, 8]
const LANE_ALPHA: Record<FrameLane['emphasis'], number> = { normal: 0.75, hot: 1, dim: 0.12 }

// Each lane is a polyline from the importer's side to the imported block's
// side, where an arrowhead points into the block. Lanes off screen are
// skipped; dimmed ones go first so highlighted ones stay on top.
function drawLanes(
  ctx: CanvasRenderingContext2D,
  lanes: readonly FrameLane[],
  camera: Camera,
  view: Viewport,
): void {
  const unit = camera.scale
  const width = Math.min(Math.max(unit * 0.25, LANE_WIDTH_PX[0]), LANE_WIDTH_PX[1])
  const arrow = Math.min(Math.max(unit * 0.8, ARROW_PX[0]), ARROW_PX[1])
  const [left, top] = camera.toWorld(0, 0)
  const [right, bottom] = camera.toWorld(view.width, view.height)
  ctx.strokeStyle = DEPENDENCY_COLOR
  ctx.fillStyle = DEPENDENCY_COLOR
  ctx.setLineDash([])
  ctx.lineJoin = 'miter'
  for (const emphasis of ['dim', 'normal', 'hot'] as const) {
    ctx.globalAlpha = LANE_ALPHA[emphasis]
    ctx.lineWidth = emphasis === 'hot' ? width + 0.75 : width
    const heads: number[] = []
    ctx.beginPath()
    for (const lane of lanes) {
      if (lane.emphasis !== emphasis || !isInView(lane.points, left, top, right, bottom)) continue
      const p = lane.points
      for (let k = 0; k + 1 < p.length; k += 2) {
        const [sx, sy] = camera.toScreen(p[k] as number, p[k + 1] as number)
        if (k === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      }
      heads.push(...p.subarray(p.length - 4))
    }
    ctx.stroke()
    ctx.beginPath()
    for (let h = 0; h < heads.length; h += 4) {
      const [px, py] = camera.toScreen(heads[h] as number, heads[h + 1] as number)
      const [qx, qy] = camera.toScreen(heads[h + 2] as number, heads[h + 3] as number)
      const angle = Math.atan2(qy - py, qx - px)
      const back = (side: number) => [
        qx - Math.cos(angle) * arrow + side * Math.sin(angle) * arrow * 0.5,
        qy - Math.sin(angle) * arrow - side * Math.cos(angle) * arrow * 0.5,
      ]
      const [ax, ay] = back(1) as [number, number]
      const [bx, by] = back(-1) as [number, number]
      ctx.moveTo(qx, qy)
      ctx.lineTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.closePath()
    }
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// Whether a lane's bounding box meets the world-space window.
function isInView(
  points: Float64Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (let k = 0; k + 1 < points.length; k += 2) {
    const x = points[k] as number
    const y = points[k + 1] as number
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return x1 >= left && x0 <= right && y1 >= top && y0 <= bottom
}

// The deepest drawn node under a screen point.
export function hitTest(drawn: Drawn[], sx: number, sy: number): Drawn | undefined {
  for (let i = drawn.length - 1; i >= 0; i--) {
    const item = drawn[i]
    if (!item || item.alpha < 0.25) continue
    if (sx >= item.x && sx <= item.x + item.w && sy >= item.y && sy <= item.y + item.h) return item
  }
  return undefined
}
