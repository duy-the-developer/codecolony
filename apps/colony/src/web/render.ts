import type { Edge, SymbolKind, WorldNode } from '../shared/world-types.ts'
import type { Camera, Viewport } from './camera.ts'
import { fade, LABEL_FONT, MIN_VISIBLE_PX, openness } from './lod.ts'
import { MIN_ROAD_ALPHA, RoadCache } from './road-cache.ts'
import type { Scene } from './scene.ts'

// Draws one frame: blueprint grid, buildings (with complexity shadows),
// roads between whatever is visible at this zoom, then labels.

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
const GRID = '#16293d'
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
      drawBody(ctx, item, open, labels)
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
    ctx.strokeRect(selected.x - 1, selected.y - 1, selected.w + 2, selected.h + 2)
  }
  return drawn
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, view: Viewport): void {
  // A power-of-ten grid whose spacing stays between 12 and 120 px.
  let step = 10 ** Math.floor(Math.log10(12 / camera.scale))
  if (step * camera.scale < 12) step *= 10
  for (const [spacing, alpha] of [
    [step, fade(step * camera.scale, [12, 40]) * 0.6],
    [step * 10, 1],
  ] as const) {
    if (alpha <= 0) continue
    ctx.globalAlpha = alpha
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    ctx.beginPath()
    const [wx, wy] = camera.toWorld(0, 0)
    for (let gx = Math.floor(wx / spacing) * spacing; ; gx += spacing) {
      const [sx] = camera.toScreen(gx, 0)
      if (sx > view.width) break
      ctx.moveTo(Math.round(sx) + 0.5, 0)
      ctx.lineTo(Math.round(sx) + 0.5, view.height)
    }
    for (let gy = Math.floor(wy / spacing) * spacing; ; gy += spacing) {
      const [, sy] = camera.toScreen(0, gy)
      if (sy > view.height) break
      ctx.moveTo(0, Math.round(sy) + 0.5)
      ctx.lineTo(view.width, Math.round(sy) + 0.5)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

const hues = new Map<string, number>()
// A stable hue per top-level folder of a repository, so a district keeps its
// colour at every zoom.
export function hueOf(node: WorldNode): number {
  const key = node.path ? (node.path.split('/')[0] ?? '') : node.name
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

// Complexity shows as a drop shadow: longer for denser branching.
function shadowLength(node: WorldNode, w: number, h: number): number {
  const side = Math.min(w, h)
  const density =
    node.kind === 'file' ? node.complexity : (node.complexity * 40) / Math.max(node.lines, 1)
  return Math.min(Math.log2(1 + density) * 0.025 * side, 0.15 * side)
}

function drawBody(ctx: CanvasRenderingContext2D, item: Drawn, open: number, labels: Label[]): void {
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
  if (node.kind === 'file' || closed > 0.01) {
    const d = shadowLength(node, w, h)
    if (d > 0.5) {
      ctx.globalAlpha = alpha * (node.kind === 'file' ? 1 : closed) * 0.3
      ctx.fillStyle = '#000'
      ctx.fillRect(x + d, y + d, w, h)
    }
  }

  if (node.kind === 'project') {
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'
    ctx.fillRect(x, y, w, h)
    ctx.setLineDash([8, 6])
    ctx.strokeStyle = '#6d8fb3'
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  } else if (node.kind === 'repo') {
    ctx.globalAlpha = alpha
    ctx.fillStyle = `rgba(16, 34, 53, ${0.6 + 0.4 * closed})`
    ctx.fillRect(x, y, w, h)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#7fa9d6'
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  } else if (node.kind === 'dir') {
    ctx.globalAlpha = alpha
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${18 + 8 * closed}%, ${0.55 + 0.45 * closed})`
    ctx.fillRect(x, y, w, h)
    ctx.lineWidth = node.package ? 2 : 1
    ctx.strokeStyle = `hsl(${hue}, ${sat + 15}%, 50%)`
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  } else if (node.kind === 'file') {
    ctx.globalAlpha = alpha
    const light = node.language === 'text' || node.language === 'binary' ? 24 : 34
    ctx.fillStyle = `hsl(${hue}, ${node.language === 'text' ? 8 : sat}%, ${light - 12 * open}%)`
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = `hsl(${hue}, ${sat + 20}%, 62%)`
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  }

  // Closed: name in the middle. Open: name in the header strip.
  const name = node.kind === 'project' ? node.name.toUpperCase() : node.name
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
    const size =
      node.kind === 'file'
        ? Math.min(12, 0.08 * Math.min(w, h) * 0.8)
        : Math.min(14, 0.035 * Math.max(w, h))
    const inset = node.kind === 'file' ? 0.08 * Math.min(w, h) : size * 0.6
    labels.push({
      text: name,
      x: x + inset,
      y: y + (node.kind === 'file' ? inset / 2 : size * 1.1),
      size,
      alpha: alpha * open * fade(size, LABEL_FONT),
      maxWidth: w - 2 * inset,
      align: 'left',
      color: node.kind === 'project' ? '#9db8d6' : '#dbe7f3',
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

const roadCaches = new WeakMap<Scene, RoadCache>()

// Each edge is drawn between the deepest visible nodes that hold its ends, so
// roads merge as you zoom out and split as you zoom in (see road-cache.ts).
function drawRoads(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  scale: number,
  drawn: Drawn[],
  state: RenderState,
): void {
  let cache = roadCaches.get(scene)
  if (!cache) {
    cache = new RoadCache(scene)
    roadCaches.set(scene, cache)
  }
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
