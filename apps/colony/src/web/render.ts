import { type Edge, HEADER_UNITS, type SymbolKind, type WorldNode } from '../shared/world-types.ts'
import type { Camera, Viewport } from './camera.ts'
import { fade, GRID_FADE, LABEL_FONT, MIN_VISIBLE_PX, openness } from './lod.ts'
import { MIN_ROAD_ALPHA, RoadCache } from './road-cache.ts'
import type { Scene } from './scene.ts'

// Draws one frame: the unit grid, flat blocks (fill plus a 1px border), roads
// between whatever is visible at this zoom, then labels. World coordinates are
// grid units, and block edges are rounded to pixels the same way as grid
// lines, so every edge sits on a grid line.

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
  // The selected node and everything inside it.
  selectedSubtree: ReadonlySet<string>
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

  drawRoads(ctx, scene, camera.scale, drawn, state)
  drawLabels(ctx, labels)
  const selected = drawn.find((d) => d.node.id === state.selected)
  if (selected) {
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#ffd166'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    const { x0, y0, x1, y1 } = snap(selected)
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, x1 - x0 + 2, y1 - y0 + 2)
  }
  return drawn
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
    // A tinted band with no outline, so roads can cross its edge cleanly.
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

// One road cache per scene, rebuilt when symbols arrive.
const roadCaches = new WeakMap<Scene, { revision: number; cache: RoadCache }>()

// Each edge is drawn between the deepest visible nodes that hold its ends, so
// roads merge as you zoom out and split as you zoom in (see road-cache.ts).
function drawRoads(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  scale: number,
  drawn: Drawn[],
  state: RenderState,
): void {
  let cached = roadCaches.get(scene)
  if (cached?.revision !== scene.revision) {
    cached = { revision: scene.revision, cache: new RoadCache(scene) }
    roadCaches.set(scene, cached)
  }
  const { cache } = cached
  const holders = drawn.filter((item) => item.alpha >= MIN_ROAD_ALPHA)
  const roads = cache.listRoads(scale, holders, state.selectedSubtree)

  const dimmed = state.selected !== undefined
  for (let r = 0; r < roads.count; r++) {
    const road = {
      from: holders[roads.from[r] as number] as Drawn,
      to: holders[roads.to[r] as number] as Drawn,
      kind: roads.kind[r] as Edge['kind'],
      proven: roads.proven[r] === 1,
      count: roads.edges[r] as number,
      hot: roads.hot[r] === 1,
    }
    let ax = road.from.x + road.from.w / 2
    let ay = road.from.y + road.from.h / 2
    let bx = road.to.x + road.to.w / 2
    let by = road.to.y + road.to.h / 2
    let cx: number
    let cy: number
    if (roads.sameFile[r]) {
      // Calls inside one file loop out of the right edge of the bands.
      ax = road.from.x + road.from.w
      bx = road.to.x + road.to.w
      ay = road.from.y + Math.min(road.from.h / 2, 6)
      by = road.to.y + Math.min(road.to.h / 2, 6)
      cx = Math.max(ax, bx) + Math.min(Math.abs(by - ay) * 0.5, 120)
      cy = (ay + by) / 2
    } else {
      // Bend every road a little so two-way roads do not overlap.
      cx = (ax + bx) / 2 - (by - ay) * 0.15
      cy = (ay + by) / 2 + (bx - ax) * 0.15
    }
    const base = road.kind === 'import' ? 0.3 : 0.6
    ctx.globalAlpha = road.hot ? 0.95 : dimmed ? base * 0.35 : base
    ctx.strokeStyle = EDGE_COLORS[road.kind]
    ctx.lineWidth = (road.kind === 'import' ? 0.8 : 1.4) * (1 + Math.log2(road.count))
    ctx.setLineDash(road.proven ? [] : [6, 4])
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.quadraticCurveTo(cx, cy, bx, by)
    ctx.stroke()
    // Direction: an arrowhead at the middle of the curve.
    const mx = 0.25 * ax + 0.5 * cx + 0.25 * bx
    const my = 0.25 * ay + 0.5 * cy + 0.25 * by
    const angle = Math.atan2(by - ay, bx - ax)
    const size = 4 + ctx.lineWidth
    ctx.setLineDash([])
    ctx.fillStyle = EDGE_COLORS[road.kind]
    ctx.beginPath()
    ctx.moveTo(mx + Math.cos(angle) * size, my + Math.sin(angle) * size)
    ctx.lineTo(mx + Math.cos(angle + 2.5) * size, my + Math.sin(angle + 2.5) * size)
    ctx.lineTo(mx + Math.cos(angle - 2.5) * size, my + Math.sin(angle - 2.5) * size)
    ctx.fill()
  }
  ctx.globalAlpha = 1
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
