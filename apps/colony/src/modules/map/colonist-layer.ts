import type { PlacedColonist } from '../scene/colonist-places.ts'
import type { Scene } from '../scene/scene.ts'
import { COLONIST_GLYPHS, COLONIST_STATUS_TEXT, GLYPH_PATHS } from '../theme/colonist-glyphs.ts'
import {
  CHANGE_CASING,
  CHANGE_COLORS,
  COLONIST_CHIP,
  COLONIST_COLORS,
  COLONIST_INK,
  CONFLICT_COLOR,
  REMOVED_VEIL,
} from '../theme/palette.ts'
import type { Rect } from '../world/world-types.ts'
import type { Camera, Viewport } from './camera.ts'
import {
  BADGE_RADIUS_PX,
  type ConflictBadge,
  layoutPins,
  type Pin,
  type PinLayout,
  POINTER_PX,
} from './colonist-pins.ts'
import { LABEL_FONT } from './lod.ts'
import type { Drawn } from './render.ts'

// Colonists on the map. Each has one robot, standing on the file it saved
// last (its block, or the closed folder showing it when zoomed out); it moves
// as the worker saves other files and stays put while it idles or waits.
//
// The Git overlay draws every colonist's diff as dashed outlines: blue on
// modified files, red over removed ones, and green placeholder squares for
// added files in the folder they are added to. Zoomed out, a closed folder
// that holds changes gets one outline (blue when they mix). With the overlay
// off, only the picked colonist's outlines are drawn; with it on, picking one
// dims the others'.
//
// The Owners overlay puts a pin on every changed file in its colonist's
// status colour with its initials (see colonist-pins.ts). A file two
// colonists change carries a possible-conflict badge either way. Robots,
// pins and badges are drawn on their own canvas over the map, so they can
// bob and pulse without redrawing it.

type ChangeKind = keyof typeof CHANGE_COLORS
type ColonistStatus = PlacedColonist['colonist']['status']

// A colonist's robot on screen.
export interface Robot {
  colonistId: string
  status: ColonistStatus
  // The file it saved last.
  path: string | undefined
  // Where its stem touches the block.
  tipX: number
  tipY: number
  // How far its chip stands above the usual, on a longer stem, to clear
  // the robots placed before it.
  lift: number
}

// What is under the pointer: a robot, a colonist's pin, or the
// possible-conflict badge on a block.
export type MarkerHit =
  | { kind: 'robot'; colonistId: string; robot: Robot }
  | { kind: 'pin'; colonistId: string; pin: Pin }
  | { kind: 'conflict'; badge: ConflictBadge }

// Names a robot, pin or badge across frames.
export function keyOfHit(hit: MarkerHit): string {
  if (hit.kind === 'robot') return `robot\0${hit.colonistId}`
  return hit.kind === 'pin'
    ? `pin\0${hit.colonistId}\0${hit.pin.nodeId}\0${hit.pin.path}`
    : `conflict\0${hit.badge.nodeId}\0${hit.badge.paths.join('\0')}`
}

const CHIP_PX = 22
const ICON_PX = 15
const ROBOT_POINTER_PX = 8
const BOB_PX = 2.5
const BOB_MS = 1400
// Others' robots with a colonist picked: dimmer, still easy to find.
const OTHER_ROBOTS_ALPHA = 0.5

const PULSE_MS = 1600
const IDLE_ALPHA = 0.55
// With a colonist picked, the others' outlines and pins step back to this.
const OTHERS_ALPHA = 0.35
const LINE_PX = 1.75
const SELECTED_LINE_PX = 2.5
const DASHES: Record<ChangeKind, readonly number[]> = {
  modified: [6, 3],
  added: [5, 3],
  removed: [3, 3],
}
// A block counts as shown once it is drawn at least this opaque; a change
// whose block is fainter outlines the closed folder around it instead.
const SHOWN_ALPHA = 0.5
const HATCH_PX = 6
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'

export class ColonistLayer {
  selected: string | undefined
  hovered: MarkerHit | undefined
  // The Git overlay: every colonist's outlines, not only the picked one's.
  showGit = false
  // The Owners overlay: a pin on every changed file.
  showOwners = false
  private colonists: readonly PlacedColonist[] = []
  private layout: PinLayout = { pins: [], badges: [] }
  private robots: Robot[] = []
  private readonly labels = new Map<string, string>()
  private readonly counts = new Map<string, number>()
  private readonly glyphs = new Map<string, Path2D[]>()

  setColonists(colonists: readonly PlacedColonist[]): void {
    this.colonists = colonists
    this.labels.clear()
    this.counts.clear()
    for (const { colonist } of colonists) {
      this.labels.set(colonist.id, colonist.label)
      this.counts.set(colonist.id, colonist.changes.length + colonist.omitted)
    }
    if (this.selected && !this.has(this.selected)) this.selected = undefined
    this.hovered = undefined
  }

  has(id: string): boolean {
    return this.colonists.some((placed) => placed.colonist.id === id)
  }

  boundsOf(id: string): Rect | undefined {
    return this.colonists.find((placed) => placed.colonist.id === id)?.bounds
  }

  // The pins and badges of the last frame.
  get pins(): PinLayout {
    return this.layout
  }

  // True while something on screen moves: a working robot bobs, a waiting
  // one and its pins pulse.
  get isAnimated(): boolean {
    return (
      this.robots.some((robot) => robot.status === 'working' || robot.status === 'waiting') ||
      this.layout.pins.some((pin) => pin.status === 'waiting')
    )
  }

  // Draws the colonists' diffs over the map's blocks (every colonist's with
  // the Git overlay on, else the picked one's) and works out where the robots,
  // pins and badges go. drawn: the frame's blocks, parents before children.
  drawChanges(ctx: CanvasRenderingContext2D, scene: Scene, camera: Camera, drawn: Drawn[]): void {
    const byId = new Map(drawn.map((item) => [item.node.id, item]))
    const ordered = [...this.colonists].sort(
      (a, b) => Number(a.colonist.id === this.selected) - Number(b.colonist.id === this.selected),
    )
    const onScreen = (rect: Rect) => {
      const [x, y] = camera.toScreen(rect.x, rect.y)
      return (
        x <= ctx.canvas.clientWidth &&
        y <= ctx.canvas.clientHeight &&
        x + rect.w * camera.scale >= 0 &&
        y + rect.h * camera.scale >= 0
      )
    }
    // The block that shows a node: itself when drawn plainly, else the
    // nearest folder around it that is.
    const shownBlock = (id: string): Drawn | undefined => {
      for (
        let node = scene.byId.get(id);
        node && node.kind !== 'world';
        node = scene.parentOf(node)
      ) {
        const item = byId.get(node.id)
        if (item && item.alpha >= SHOWN_ALPHA) return item
      }
      return undefined
    }
    const robots: Robot[] = []
    for (const placed of this.colonists) {
      const anchor = this.anchorOf(placed, scene, camera, byId, shownBlock, onScreen)
      if (!anchor) continue
      robots.push({
        colonistId: placed.colonist.id,
        status: placed.colonist.status,
        path: placed.colonist.lastSaved,
        tipX: anchor.x + anchor.w / 2,
        tipY: anchor.y + Math.min(anchor.h / 2, 1),
        lift: 0,
      })
    }
    this.robots = spreadRobots(robots)
    for (const placed of ordered) {
      const { colonist } = placed
      const isSelected = colonist.id === this.selected
      if (!this.showGit && !isSelected) continue
      const alpha =
        (colonist.status === 'idle' ? IDLE_ALPHA : 1) *
        (this.selected && !isSelected ? OTHERS_ALPHA : 1)
      const width = isSelected ? SELECTED_LINE_PX : LINE_PX
      // Closed folders standing for changes inside them, with the kinds.
      const folders = new Map<string, { item: Drawn; kinds: Set<ChangeKind> }>()
      const toFolder = (item: Drawn, kind: ChangeKind) => {
        if (item.open >= SHOWN_ALPHA) return
        const entry = folders.get(item.node.id) ?? { item, kinds: new Set<ChangeKind>() }
        entry.kinds.add(kind)
        folders.set(item.node.id, entry)
      }
      ctx.globalAlpha = alpha
      for (const change of placed.changes) {
        if (change.nodeId) {
          const file = scene.byId.get(change.nodeId)
          if (!file || !onScreen(file.rect)) continue
          const item = byId.get(change.nodeId)
          if (item && item.alpha >= SHOWN_ALPHA) {
            drawFileChange(ctx, item, change.kind, width)
          } else {
            const block = shownBlock(change.nodeId)
            if (block) toFolder(block, change.kind)
          }
        } else if (change.placeholder && change.holderId) {
          if (!onScreen(change.placeholder)) continue
          const holder = byId.get(change.holderId)
          if (holder && holder.alpha * holder.open >= SHOWN_ALPHA) {
            const rect = toScreenRect(camera, change.placeholder)
            drawPlaceholder(ctx, rect, change.path.split('/').at(-1) ?? '', width)
          } else {
            const block = shownBlock(change.holderId)
            if (block) toFolder(block, 'added')
          }
        }
      }
      for (const folder of placed.folders) {
        const holder = byId.get(folder.holderId)
        if (!holder || holder.alpha * holder.open < SHOWN_ALPHA || !onScreen(folder.rect)) continue
        const rect = toScreenRect(camera, folder.rect)
        drawNewFolder(ctx, rect, folder.name, width, folder.header * camera.scale)
      }
      for (const { item, kinds } of folders.values()) {
        const kind = kinds.size === 1 ? ([...kinds][0] as ChangeKind) : 'modified'
        strokeDiff(ctx, snapRect(item), kind, width)
      }
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    const view = { width: ctx.canvas.clientWidth, height: ctx.canvas.clientHeight }
    this.layout = layoutPins(this.colonists, scene, camera, view, drawn, {
      withPins: this.showOwners,
      obstacles: this.robots.map(robotBox),
    })
    // The hovered pin or badge moved with the map: follow it, or let it go.
    const key = this.hovered && keyOfHit(this.hovered)
    this.hovered = key ? this.findHit(key) : undefined
  }

  // Where a colonist's robot stands: the block of the file it saved last,
  // else of its first change; the closed folder showing it when the file is
  // too small to draw.
  private anchorOf(
    placed: PlacedColonist,
    scene: Scene,
    camera: Camera,
    byId: ReadonlyMap<string, Drawn>,
    shownBlock: (id: string) => Drawn | undefined,
    onScreen: (rect: Rect) => boolean,
  ): Rect | undefined {
    const { lastSaved } = placed.colonist
    const change =
      placed.changes.find((c) => c.path === lastSaved && (c.nodeId || c.holderId)) ??
      placed.changes.find((c) => c.nodeId || c.holderId)
    if (!change) return undefined
    // Off screen, the map leaves the block out: the robot goes with it,
    // rather than onto a folder around it that is still on screen.
    const node = scene.byId.get(change.nodeId ?? change.holderId ?? '')
    const area = change.nodeId ? node?.rect : (change.placeholder ?? node?.rect)
    if (area && !onScreen(area)) return toScreenRect(camera, area)
    if (change.nodeId) {
      const item = byId.get(change.nodeId)
      if (item && item.alpha >= SHOWN_ALPHA) return snapRect(item)
      const block = shownBlock(change.nodeId)
      return block && snapRect(block)
    }
    if (change.holderId) {
      const holder = byId.get(change.holderId)
      if (change.placeholder && holder && holder.alpha * holder.open >= SHOWN_ALPHA)
        return snapRect(toScreenRect(camera, change.placeholder))
      const block = shownBlock(change.holderId)
      if (block) return snapRect(block)
      return node && toScreenRect(camera, node.rect)
    }
    return undefined
  }

  private findHit(key: string): MarkerHit | undefined {
    const robot = this.robots.find(
      (r) => keyOfHit({ kind: 'robot', colonistId: r.colonistId, robot: r }) === key,
    )
    if (robot) return { kind: 'robot', colonistId: robot.colonistId, robot }
    const pin = this.layout.pins.find(
      (p) => keyOfHit({ kind: 'pin', colonistId: p.colonistId, pin: p }) === key,
    )
    if (pin) return { kind: 'pin', colonistId: pin.colonistId, pin }
    const badge = this.layout.badges.find((b) => keyOfHit({ kind: 'conflict', badge: b }) === key)
    return badge && { kind: 'conflict', badge }
  }

  // Draws the pins, badges and robots on their own canvas, the picked
  // colonist's on top; now drives the bob and pulse.
  drawMarkers(ctx: CanvasRenderingContext2D, view: Viewport, now: number, isStill: boolean): void {
    ctx.clearRect(0, 0, view.width, view.height)
    const { pins, badges } = this.layout
    const ordered = [...pins].sort(
      (a, b) => Number(a.colonistId === this.selected) - Number(b.colonistId === this.selected),
    )
    for (const pin of ordered) {
      const isSelected = pin.colonistId === this.selected
      const alpha =
        (pin.status === 'idle' ? IDLE_ALPHA : 1) * (this.selected && !isSelected ? OTHERS_ALPHA : 1)
      const pulse = pin.status === 'waiting' && !isStill ? (now % PULSE_MS) / PULSE_MS : undefined
      drawPin(ctx, pin, alpha, isSelected, pulse)
    }
    for (const badge of badges) {
      const isDimmed = this.selected !== undefined && !badge.colonistIds.includes(this.selected)
      drawConflictBadge(ctx, badge, isDimmed ? OTHERS_ALPHA : 1)
    }
    // Lifted robots first, so their stems pass behind the chips below.
    const robots = [...this.robots].sort(
      (a, b) =>
        Number(a.colonistId === this.selected) - Number(b.colonistId === this.selected) ||
        b.lift - a.lift,
    )
    for (const robot of robots) {
      const isSelected = robot.colonistId === this.selected
      const alpha =
        (robot.status === 'idle' ? IDLE_ALPHA : 1) *
        (this.selected && !isSelected ? OTHER_ROBOTS_ALPHA : 1)
      this.drawRobot(ctx, robot, alpha, isSelected, now, isStill)
    }
    ctx.globalAlpha = 1
    // Only while hovered: a selected robot keeps its ring, and its label would
    // hide the map around where it works (the Inspector says the same).
    if (this.hovered) drawHoverLabel(ctx, this.hovered, view, this.labels, this.counts)
  }

  private drawRobot(
    ctx: CanvasRenderingContext2D,
    robot: Robot,
    alpha: number,
    isSelected: boolean,
    now: number,
    isStill: boolean,
  ): void {
    const color = COLONIST_COLORS[robot.status]
    const bob =
      robot.status === 'working' && !isStill
        ? -BOB_PX * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / BOB_MS))
        : 0
    const { x, y } = chipCentre(robot)
    const cy = y + bob
    ctx.setLineDash([])
    if (robot.status === 'waiting' && !isStill) {
      const phase = (now % PULSE_MS) / PULSE_MS
      ctx.globalAlpha = alpha * (1 - phase)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      roundRect(
        ctx,
        x - CHIP_PX / 2 - 6 * phase,
        cy - CHIP_PX / 2 - 6 * phase,
        CHIP_PX + 12 * phase,
        CHIP_PX + 12 * phase,
        6 + 3 * phase,
      )
      ctx.stroke()
    }
    ctx.globalAlpha = alpha
    // The stem, then the chip over it. The stem stays on the block while
    // the chip bobs.
    drawStem(ctx, x, cy + CHIP_PX / 2, robot.tipY, color)
    ctx.fillStyle = COLONIST_CHIP
    ctx.strokeStyle = color
    ctx.lineWidth = 1.25
    roundRect(ctx, x - CHIP_PX / 2, cy - CHIP_PX / 2, CHIP_PX, CHIP_PX, 6)
    ctx.fill()
    ctx.stroke()
    if (isSelected) {
      ctx.strokeStyle = COLONIST_INK
      ctx.lineWidth = 2
      roundRect(ctx, x - CHIP_PX / 2 - 2.5, cy - CHIP_PX / 2 - 2.5, CHIP_PX + 5, CHIP_PX + 5, 8)
      ctx.stroke()
    }
    const name = COLONIST_GLYPHS[robot.status]
    let paths = this.glyphs.get(name)
    if (!paths) {
      paths = GLYPH_PATHS[name].map((d) => new Path2D(d))
      this.glyphs.set(name, paths)
    }
    const scale = ICON_PX / 24
    const base = ctx.getTransform()
    ctx.translate(x - ICON_PX / 2, cy - ICON_PX / 2)
    ctx.scale(scale, scale)
    ctx.strokeStyle = color
    ctx.lineWidth = 2.25
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const path of paths) ctx.stroke(path)
    ctx.setTransform(base)
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'miter'
  }

  // The robot, badge or pin under a screen point, the topmost first.
  hitMarker(sx: number, sy: number): MarkerHit | undefined {
    const { pins, badges } = this.layout
    const robots = [...this.robots].sort(
      (a, b) => Number(b.colonistId === this.selected) - Number(a.colonistId === this.selected),
    )
    for (const robot of robots) {
      const box = robotBox(robot)
      if (sx >= box.x - 1 && sx <= box.x + box.w + 1 && sy >= box.y - 1 && sy <= box.y + box.h)
        return { kind: 'robot', colonistId: robot.colonistId, robot }
    }
    for (let i = badges.length - 1; i >= 0; i--) {
      const badge = badges[i] as ConflictBadge
      if (Math.hypot(sx - badge.x, sy - badge.y) <= BADGE_RADIUS_PX + 1)
        return { kind: 'conflict', badge }
    }
    const ordered = [...pins].sort(
      (a, b) => Number(b.colonistId === this.selected) - Number(a.colonistId === this.selected),
    )
    for (const pin of ordered) {
      const { head } = pin
      const bottom = head.y + head.h + POINTER_PX
      if (sx >= head.x - 1 && sx <= head.x + head.w + 1 && sy >= head.y - 1 && sy <= bottom)
        return { kind: 'pin', colonistId: pin.colonistId, pin }
    }
    return undefined
  }
}

function chipCentre(robot: Robot): { x: number; y: number } {
  return { x: robot.tipX, y: robot.tipY - ROBOT_POINTER_PX - CHIP_PX / 2 - robot.lift }
}

// The robot's chip and stem on screen, with room for the bob.
function robotBox(robot: Robot): Rect {
  const { x, y } = chipCentre(robot)
  return {
    x: x - CHIP_PX / 2,
    y: y - CHIP_PX / 2 - BOB_PX,
    w: CHIP_PX,
    h: CHIP_PX + BOB_PX + ROBOT_POINTER_PX,
  }
}

// Lifts each robot that would cover one placed before it, a chip's height at
// a time, so it stands above on a longer stem. Its stem stays on its own
// block; robots on blocks far enough apart stay side by side.
function spreadRobots(robots: Robot[]): Robot[] {
  const placed: Robot[] = []
  for (const robot of [...robots].sort((a, b) => a.tipY - b.tipY || a.tipX - b.tipX)) {
    const lifted = { ...robot }
    while (placed.some((other) => overlaps(robotBox(other), robotBox(lifted))))
      lifted.lift += CHIP_PX + BOB_PX + ROBOT_POINTER_PX
    placed.push(lifted)
  }
  return placed
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

// One device pixel, so it never blurs into a wedge.
const STEM_PX = 1

// A thin straight line from a chip down to its block, in the chip's colour.
function drawStem(
  ctx: CanvasRenderingContext2D,
  x: number,
  fromY: number,
  toY: number,
  color: string,
): void {
  const ratio = ctx.getTransform().a || 1
  const width = STEM_PX / ratio
  // On the device pixel grid: a 1px line centred on a pixel's middle.
  const sx = (Math.floor(x * ratio) + 0.5) / ratio
  ctx.setLineDash([])
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(sx, Math.round(fromY))
  ctx.lineTo(sx, Math.round(toY))
  ctx.stroke()
}

// A rounded tag with the colonist's initials, on a thin stem down to the
// block's corner.
function drawPin(
  ctx: CanvasRenderingContext2D,
  pin: Pin,
  alpha: number,
  isSelected: boolean,
  pulse: number | undefined,
): void {
  const color = COLONIST_COLORS[pin.status]
  const { head } = pin
  const r = head.h / 2
  ctx.setLineDash([])
  if (pulse !== undefined) {
    ctx.globalAlpha = alpha * (1 - pulse)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    roundRect(
      ctx,
      head.x - 4 * pulse,
      head.y - 4 * pulse,
      head.w + 8 * pulse,
      head.h + 8 * pulse,
      r,
    )
    ctx.stroke()
  }
  ctx.globalAlpha = alpha
  drawStem(ctx, pin.tipX, head.y + head.h, pin.tipY, color)
  ctx.fillStyle = color
  ctx.strokeStyle = COLONIST_CHIP
  ctx.lineWidth = 1
  roundRect(ctx, head.x, head.y, head.w, head.h, r)
  ctx.fill()
  ctx.stroke()
  if (isSelected) {
    ctx.strokeStyle = COLONIST_INK
    ctx.lineWidth = 1.5
    roundRect(ctx, head.x - 2, head.y - 2, head.w + 4, head.h + 4, r + 2)
    ctx.stroke()
  }
  ctx.font = `700 9px ${FONT}`
  ctx.fillStyle = COLONIST_CHIP
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(pin.text, head.x + head.w / 2, head.y + head.h / 2 + 0.5)
}

// The possible-conflict badge: an exclamation mark in a circle.
function drawConflictBadge(ctx: CanvasRenderingContext2D, badge: ConflictBadge, alpha: number) {
  ctx.globalAlpha = alpha
  ctx.setLineDash([])
  if (badge.tipY !== undefined)
    drawStem(ctx, badge.x, badge.y + BADGE_RADIUS_PX, badge.tipY, CONFLICT_COLOR)
  ctx.fillStyle = CONFLICT_COLOR
  ctx.strokeStyle = COLONIST_CHIP
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(badge.x, badge.y, BADGE_RADIUS_PX, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  ctx.font = `800 10px ${FONT}`
  ctx.fillStyle = COLONIST_CHIP
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', badge.x, badge.y + 0.5)
}

function toScreenRect(camera: Camera, rect: Rect): Rect {
  const [x, y] = camera.toScreen(rect.x, rect.y)
  return { x, y, w: rect.w * camera.scale, h: rect.h * camera.scale }
}

// A rectangle on whole pixels, like the map's blocks.
function snapRect({ x, y, w, h }: Rect): Rect {
  const x0 = Math.round(x)
  const y0 = Math.round(y)
  return { x: x0, y: y0, w: Math.round(x + w) - x0, h: Math.round(y + h) - y0 }
}

// A dashed outline just inside a block's edge, on a dark casing.
function strokeDiff(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  kind: ChangeKind,
  width: number,
): void {
  const inset = width / 2 + 1
  const w = rect.w - 2 * inset
  const h = rect.h - 2 * inset
  if (w < 1 || h < 1) return
  ctx.setLineDash([])
  ctx.strokeStyle = CHANGE_CASING
  ctx.lineWidth = width + 1.5
  ctx.strokeRect(rect.x + inset, rect.y + inset, w, h)
  ctx.setLineDash(DASHES[kind])
  ctx.strokeStyle = CHANGE_COLORS[kind]
  ctx.lineWidth = width
  ctx.strokeRect(rect.x + inset, rect.y + inset, w, h)
}

function drawFileChange(
  ctx: CanvasRenderingContext2D,
  item: Drawn,
  kind: ChangeKind,
  width: number,
): void {
  const rect = snapRect(item)
  if (kind === 'removed') {
    const alpha = ctx.globalAlpha
    ctx.fillStyle = REMOVED_VEIL
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.w, rect.h)
    ctx.clip()
    ctx.globalAlpha = alpha * 0.45
    ctx.strokeStyle = CHANGE_COLORS.removed
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    for (let d = -rect.h; d < rect.w; d += HATCH_PX) {
      ctx.moveTo(rect.x + d, rect.y + rect.h)
      ctx.lineTo(rect.x + d + rect.h, rect.y)
    }
    ctx.stroke()
    ctx.restore()
  }
  strokeDiff(ctx, rect, kind, width)
}

// An added file: a dashed green square with a faint fill, labelled when it
// is big enough to read.
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  name: string,
  width: number,
): void {
  const snapped = snapRect(rect)
  if (snapped.w < 3 || snapped.h < 3) return
  const alpha = ctx.globalAlpha
  ctx.globalAlpha = alpha * 0.1
  ctx.fillStyle = CHANGE_COLORS.added
  ctx.fillRect(snapped.x, snapped.y, snapped.w, snapped.h)
  ctx.globalAlpha = alpha
  strokeDiff(ctx, snapped, 'added', width)
  const size = Math.min(13, snapped.h * 0.22, snapped.w / Math.max(name.length * 0.62, 1))
  if (size < LABEL_FONT[0]) return
  ctx.font = `500 ${size.toFixed(1)}px ${FONT}`
  ctx.fillStyle = COLONIST_INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, snapped.x + snapped.w / 2, snapped.y + snapped.h / 2)
}

// A folder a colonist adds: one dashed box labelled `<name>/ new`.
function drawNewFolder(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  name: string,
  width: number,
  headerPx: number,
): void {
  const snapped = snapRect(rect)
  if (snapped.w < 4 || snapped.h < 4) return
  const alpha = ctx.globalAlpha
  ctx.globalAlpha = alpha * 0.08
  ctx.fillStyle = CHANGE_COLORS.added
  ctx.fillRect(snapped.x, snapped.y, snapped.w, snapped.h)
  ctx.globalAlpha = alpha
  strokeDiff(ctx, snapped, 'added', width)
  const size = Math.min(12, headerPx * 0.7)
  if (size < LABEL_FONT[0]) return
  ctx.font = `600 ${size.toFixed(1)}px ${FONT}`
  ctx.fillStyle = CHANGE_COLORS.added
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${name}/ new`, snapped.x + size * 0.6, snapped.y + headerPx / 2, snapped.w - size)
}

// What the hovered pin or badge stands for, next to it.
function drawHoverLabel(
  ctx: CanvasRenderingContext2D,
  hit: MarkerHit,
  view: Viewport,
  labels: ReadonlyMap<string, string>,
  counts: ReadonlyMap<string, number>,
): void {
  let color: string
  let lines: string[]
  let anchor: Rect
  if (hit.kind === 'robot') {
    const { robot } = hit
    const count = counts.get(robot.colonistId) ?? 0
    color = COLONIST_COLORS[robot.status]
    lines = [
      labels.get(robot.colonistId) ?? robot.colonistId,
      `● ${COLONIST_STATUS_TEXT[robot.status]} · ${count} ${count === 1 ? 'file' : 'files'}`,
    ]
    if (robot.path) lines.push(`last saved ${robot.path.split('/').at(-1)}`)
    anchor = robotBox(robot)
  } else if (hit.kind === 'pin') {
    const { pin } = hit
    color = COLONIST_COLORS[pin.status]
    lines = [
      labels.get(pin.colonistId) ?? pin.colonistId,
      `● ${COLONIST_STATUS_TEXT[pin.status]} · ${pin.path}`,
    ]
    if (pin.isShared) lines.push('also changed by another colonist')
    anchor = pin.head
  } else {
    const { badge } = hit
    color = CONFLICT_COLOR
    const [first] = badge.paths
    const what =
      badge.paths.length === 1 && first
        ? (first.split('/').at(-1) ?? first)
        : `${badge.paths.length} files`
    lines = [
      `Possible conflict · ${what}`,
      ...badge.colonistIds.map((id) => `● ${labels.get(id) ?? id}`),
    ]
    anchor = {
      x: badge.x - BADGE_RADIUS_PX,
      y: badge.y - BADGE_RADIUS_PX,
      w: 2 * BADGE_RADIUS_PX,
      h: 2 * BADGE_RADIUS_PX,
    }
  }
  ctx.font = `11px ${MONO}`
  const w = Math.min(
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + 16,
    view.width - 8,
  )
  const h = 10 + lines.length * 15
  let x = anchor.x + anchor.w + 8
  if (x + w > view.width - 4) x = Math.max(4, anchor.x - 8 - w)
  const y = Math.min(Math.max(4, anchor.y + anchor.h / 2 - h / 2), view.height - h - 4)
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  ctx.fillStyle = COLONIST_CHIP
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  roundRect(ctx, x, y, w, h, 4)
  ctx.fill()
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? COLONIST_INK : color
    ctx.fillText(line, x + 8, y + 12 + i * 15, w - 16)
  })
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
