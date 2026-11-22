import type { PlacedColonist } from '../scene/colonist-places.ts'
import type { Scene } from '../scene/scene.ts'
import { COLONIST_GLYPHS, COLONIST_STATUS_TEXT, GLYPH_PATHS } from '../theme/colonist-glyphs.ts'
import {
  CHANGE_CASING,
  CHANGE_COLORS,
  COLONIST_CHIP,
  COLONIST_COLORS,
  COLONIST_INK,
  REMOVED_VEIL,
} from '../theme/palette.ts'
import type { Rect } from '../world/world-types.ts'
import type { Camera, Viewport } from './camera.ts'
import { LABEL_FONT } from './lod.ts'
import type { Drawn } from './render.ts'

// Colonists on the map. Their diffs are dashed outlines drawn with the map:
// blue on modified files, red over removed ones, and green placeholder
// squares for added files in the folder they are added to. Zoomed out, a
// closed folder that holds changes gets one outline (blue when they mix).
// Each colonist has exactly one robot marker, drawn on its own canvas over
// the map so it can bob without redrawing the map.

type ChangeKind = keyof typeof CHANGE_COLORS
type ColonistStatus = PlacedColonist['colonist']['status']

interface Marker {
  id: string
  status: ColonistStatus
  label: string
  count: number
  // Where the pointer under the chip touches: the top right of a changed
  // block on screen.
  tipX: number
  tipY: number
}

const CHIP_PX = 24
const ICON_PX = 16
const POINTER_PX = 5
// Markers of different colonists on the same spot sit side by side.
const SIDE_BY_SIDE_PX = 28
const BOB_PX = 3
const BOB_MS = 1400
const PULSE_MS = 1600
const IDLE_ALPHA = 0.55
// With a colonist picked, the others' outlines step back to this.
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
  hovered: string | undefined
  private colonists: readonly PlacedColonist[] = []
  private markers: Marker[] = []
  private readonly glyphs = new Map<string, Path2D[]>()

  setColonists(colonists: readonly PlacedColonist[]): void {
    this.colonists = colonists
    if (this.selected && !this.has(this.selected)) this.selected = undefined
    if (this.hovered && !this.has(this.hovered)) this.hovered = undefined
  }

  has(id: string): boolean {
    return this.colonists.some((placed) => placed.colonist.id === id)
  }

  boundsOf(id: string): Rect | undefined {
    return this.colonists.find((placed) => placed.colonist.id === id)?.bounds
  }

  // True while a marker on screen moves: a working robot bobs, a waiting
  // one pulses.
  get isAnimated(): boolean {
    return this.markers.some((m) => m.status === 'working' || m.status === 'waiting')
  }

  // Draws every colonist's diff over the map's blocks and works out where
  // the markers go. drawn: the frame's blocks, parents before children.
  drawChanges(ctx: CanvasRenderingContext2D, scene: Scene, camera: Camera, drawn: Drawn[]): void {
    const byId = new Map(drawn.map((item) => [item.node.id, item]))
    const markers: Marker[] = []
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
    for (const placed of ordered) {
      const { colonist } = placed
      const isSelected = colonist.id === this.selected
      const alpha =
        (colonist.status === 'idle' ? IDLE_ALPHA : 1) *
        (this.selected && !isSelected ? OTHERS_ALPHA : 1)
      const width = isSelected ? SELECTED_LINE_PX : LINE_PX
      const anchors: Rect[] = []
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
            anchors.push(item)
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
            anchors.push(rect)
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
        anchors.push(rect)
      }
      for (const { item, kinds } of folders.values()) {
        const kind = kinds.size === 1 ? ([...kinds][0] as ChangeKind) : 'modified'
        strokeDiff(ctx, snapRect(item), kind, width)
        anchors.push(item)
      }
      const anchor = nearestTo(anchors, placed.bounds && toScreenRect(camera, placed.bounds))
      if (anchor) {
        markers.push({
          id: colonist.id,
          status: colonist.status,
          label: colonist.label,
          count: colonist.changes.length + colonist.omitted,
          tipX: anchor.x + anchor.w - 3,
          tipY: anchor.y + 2,
        })
      }
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    this.markers = spreadMarkers(markers)
  }

  // Draws the markers on their own canvas; now drives the bob and pulse.
  drawMarkers(ctx: CanvasRenderingContext2D, view: Viewport, now: number, isStill: boolean): void {
    ctx.clearRect(0, 0, view.width, view.height)
    let label: Marker | undefined
    for (const marker of this.markers) {
      const color = COLONIST_COLORS[marker.status]
      const isSelected = marker.id === this.selected
      const bob =
        marker.status === 'working' && !isStill
          ? -BOB_PX * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / BOB_MS))
          : 0
      const { x, y } = chipCentre(marker)
      const cy = y + bob
      ctx.globalAlpha = marker.status === 'idle' ? IDLE_ALPHA : 1
      if (marker.status === 'waiting' && !isStill) {
        const phase = (now % PULSE_MS) / PULSE_MS
        ctx.globalAlpha = 1 - phase
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.setLineDash([])
        roundRect(
          ctx,
          x - CHIP_PX / 2 - 6 * phase,
          cy - CHIP_PX / 2 - 6 * phase,
          CHIP_PX + 12 * phase,
          CHIP_PX + 12 * phase,
          6 + 3 * phase,
        )
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      // The pointer, then the chip over it.
      ctx.fillStyle = COLONIST_CHIP
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x - 4, cy + CHIP_PX / 2 - 1)
      ctx.lineTo(marker.tipX, marker.tipY + bob)
      ctx.lineTo(x + 4, cy + CHIP_PX / 2 - 1)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      roundRect(ctx, x - CHIP_PX / 2, cy - CHIP_PX / 2, CHIP_PX, CHIP_PX, 6)
      ctx.fill()
      ctx.stroke()
      if (isSelected) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        roundRect(ctx, x - CHIP_PX / 2 - 2.5, cy - CHIP_PX / 2 - 2.5, CHIP_PX + 5, CHIP_PX + 5, 8)
        ctx.stroke()
      }
      this.drawGlyph(ctx, marker.status, x, cy, color)
      if (marker.count > 1) drawBadge(ctx, x + CHIP_PX / 2, cy - CHIP_PX / 2, marker.count)
      if (marker.id === this.hovered || (isSelected && !label)) label = marker
    }
    ctx.globalAlpha = 1
    if (label) drawMarkerLabel(ctx, label, view)
  }

  // The colonist whose marker is under a screen point.
  hitMarker(sx: number, sy: number): string | undefined {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i] as Marker
      const { x, y } = chipCentre(marker)
      const half = CHIP_PX / 2 + 2
      if (Math.abs(sx - x) <= half && sy >= y - half && sy <= y + half + POINTER_PX)
        return marker.id
    }
    return undefined
  }

  private drawGlyph(
    ctx: CanvasRenderingContext2D,
    status: ColonistStatus,
    x: number,
    y: number,
    color: string,
  ): void {
    const name = COLONIST_GLYPHS[status]
    let paths = this.glyphs.get(name)
    if (!paths) {
      paths = GLYPH_PATHS[name].map((d) => new Path2D(d))
      this.glyphs.set(name, paths)
    }
    const scale = ICON_PX / 24
    const base = ctx.getTransform()
    ctx.translate(x - ICON_PX / 2, y - ICON_PX / 2)
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
}

function chipCentre(marker: Marker): { x: number; y: number } {
  return { x: marker.tipX, y: marker.tipY - POINTER_PX - CHIP_PX / 2 }
}

// Moves markers that would cover each other apart, side by side.
function spreadMarkers(markers: Marker[]): Marker[] {
  const placed: Marker[] = []
  for (const marker of [...markers].sort((a, b) => a.tipY - b.tipY || a.tipX - b.tipX)) {
    const moved = { ...marker }
    while (
      placed.some(
        (other) =>
          Math.abs(other.tipX - moved.tipX) < SIDE_BY_SIDE_PX &&
          Math.abs(other.tipY - moved.tipY) < SIDE_BY_SIDE_PX,
      )
    ) {
      moved.tipX += SIDE_BY_SIDE_PX
    }
    placed.push(moved)
  }
  return placed
}

// The block closest to a point: the middle of everything the colonist
// touches, so its one marker sits where its work is.
function nearestTo(anchors: readonly Rect[], around: Rect | undefined): Rect | undefined {
  if (!around) return anchors[0]
  const cx = around.x + around.w / 2
  const cy = around.y + around.h / 2
  let best: Rect | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.x + anchor.w / 2 - cx, anchor.y + anchor.h / 2 - cy)
    if (distance < bestDistance) {
      best = anchor
      bestDistance = distance
    }
  }
  return best
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

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, count: number): void {
  const text = count > 99 ? '99+' : String(count)
  ctx.font = `700 9px ${FONT}`
  const w = Math.max(14, ctx.measureText(text).width + 6)
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x - w / 2, y - 7, w, 14, 7)
  ctx.fill()
  ctx.fillStyle = COLONIST_CHIP
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
}

// The colonist's name and status next to its marker.
function drawMarkerLabel(ctx: CanvasRenderingContext2D, marker: Marker, view: Viewport): void {
  const color = COLONIST_COLORS[marker.status]
  const files = `${marker.count} ${marker.count === 1 ? 'file' : 'files'}`
  const lines = [marker.label, `● ${COLONIST_STATUS_TEXT[marker.status]} · ${files}`]
  ctx.font = `11px ${MONO}`
  const w = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 16
  const h = 38
  const { x: cx, y: cy } = chipCentre(marker)
  // Clear of the count badge on the chip's corner.
  let x = cx + CHIP_PX / 2 + 12
  if (x + w > view.width - 4) x = cx - CHIP_PX / 2 - 6 - w
  const y = Math.max(4, cy - h / 2)
  ctx.globalAlpha = 1
  ctx.fillStyle = COLONIST_CHIP
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  roundRect(ctx, x, y, w, h, 4)
  ctx.fill()
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLONIST_INK
  ctx.fillText(lines[0] as string, x + 8, y + 12)
  ctx.fillStyle = color
  ctx.fillText(lines[1] as string, x + 8, y + 27)
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
