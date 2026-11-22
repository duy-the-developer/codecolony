import type { PlacedChange, PlacedColonist } from '../scene/colonist-places.ts'
import type { Scene } from '../scene/scene.ts'
import type { Rect } from '../world/world-types.ts'
import type { Camera, Viewport } from './camera.ts'
import type { Drawn } from './render.ts'

// Where colonist pins go on screen. Every file a colonist changes gets a pin
// over the top right corner of its block: the file itself, or an added
// file's placeholder, at every zoom, so the pins match the colonist's files
// one for one. Pins on the same block sit side by side
// in roster order, right to left. A block holding a file two or more
// colonists change also gets a possible-conflict badge, left of its pins.
// A row that would cover another block's pins is lifted above them, on a
// longer stem, so every pin still points at its own block.

type ColonistStatus = PlacedColonist['colonist']['status']

export interface Pin {
  colonistId: string
  status: ColonistStatus
  text: string
  // The block it stands on: the file, or the folder holding the placeholder.
  nodeId: string
  // The change it stands for.
  path: string
  // One of its files is changed by another colonist too.
  isShared: boolean
  // Its head on screen.
  head: Rect
  // Where its pointer touches the block.
  tipX: number
  tipY: number
}

export interface ConflictBadge {
  nodeId: string
  // Every colonist changing a shared file there.
  colonistIds: string[]
  // The shared files there.
  paths: string[]
  x: number
  y: number
}

export interface PinLayout {
  pins: Pin[]
  badges: ConflictBadge[]
}

export const PIN_HEIGHT_PX = 16
export const BADGE_RADIUS_PX = 7
export const POINTER_PX = 4
// A row of pins lifts at most this many times to clear the others.
const MAX_LIFTS = 4
const GAP_PX = 2
const PIN_PAD_PX = 5
// The width of a character of the pin's 9px bold text, near enough.
const PIN_CHAR_PX = 6

interface Group {
  nodeId: string
  rect: Rect
  // Each colonist's change there, by roster index.
  entries: Map<number, { placed: PlacedColonist; change: PlacedChange }>
}

// colonists: in roster order. drawn: the frame's blocks, as render returns
// them.
export function layoutPins(
  colonists: readonly PlacedColonist[],
  scene: Scene,
  camera: Camera,
  view: Viewport,
  drawn: readonly Drawn[],
): PinLayout {
  const byId = new Map(drawn.map((item) => [item.node.id, item]))
  const groups = new Map<string, Group>()
  const add = (
    key: string,
    nodeId: string,
    rect: Rect,
    index: number,
    placed: PlacedColonist,
    change: PlacedChange,
  ) => {
    let group = groups.get(key)
    if (!group) {
      group = { nodeId, rect, entries: new Map() }
      groups.set(key, group)
    }
    group.entries.set(index, { placed, change })
  }

  colonists.forEach((placed, index) => {
    for (const change of placed.changes) {
      if (change.nodeId) {
        // A block too small to draw still has its place on the map.
        const node = scene.byId.get(change.nodeId)
        const rect = byId.get(change.nodeId) ?? (node && toScreenRect(camera, node.rect))
        if (rect) add(change.nodeId, change.nodeId, rect, index, placed, change)
      } else if (change.placeholder && change.holderId) {
        // Each placeholder is its own spot, even for the same path.
        const key = `${placed.colonist.id}\0${change.path}`
        add(key, change.holderId, toScreenRect(camera, change.placeholder), index, placed, change)
      }
    }
  })

  const rows: { pins: Pin[]; badge?: ConflictBadge; box: Rect }[] = []
  for (const group of groups.values()) {
    const { rect } = group
    if (rect.x > view.width || rect.y > view.height || rect.x + rect.w < 0 || rect.y + rect.h < 0)
      continue
    const tipY = rect.y + 2
    const top = tipY - POINTER_PX - PIN_HEIGHT_PX
    let right = rect.x + rect.w
    const pins: Pin[] = []
    const shared = new Set<string>()
    const sharedPaths = new Set<string>()
    const entries = [...group.entries].sort(([a], [b]) => a - b)
    for (const [, { placed, change }] of entries) {
      const text = placed.initials
      const w = Math.max(PIN_HEIGHT_PX, PIN_PAD_PX * 2 + text.length * PIN_CHAR_PX)
      const head = { x: right - w, y: top, w, h: PIN_HEIGHT_PX }
      right -= w + GAP_PX
      const isShared = Boolean(change.sharedWith)
      if (change.sharedWith) {
        shared.add(placed.colonist.id)
        sharedPaths.add(change.path)
        for (const id of change.sharedWith) shared.add(id)
      }
      pins.push({
        colonistId: placed.colonist.id,
        status: placed.colonist.status,
        text,
        nodeId: group.nodeId,
        path: change.path,
        isShared,
        head,
        tipX: head.x + w / 2,
        tipY,
      })
    }
    const badge =
      shared.size > 0
        ? {
            nodeId: group.nodeId,
            colonistIds: [...shared],
            paths: [...sharedPaths].sort(),
            x: right - BADGE_RADIUS_PX,
            y: top + PIN_HEIGHT_PX / 2,
          }
        : undefined
    const left = badge ? badge.x - BADGE_RADIUS_PX : right + GAP_PX
    const box = { x: left, y: top, w: rect.x + rect.w - left, h: PIN_HEIGHT_PX }
    rows.push({ pins, box, ...(badge ? { badge } : {}) })
  }
  return { pins: rows.flatMap((row) => row.pins), badges: liftRows(rows) }
}

// Lifts each row of pins that would cover one already placed, top to
// bottom, by a pin's height at a time, so it stands on a longer stem over
// its block instead. Returns the badges, lifted with their rows.
function liftRows(rows: { pins: Pin[]; badge?: ConflictBadge; box: Rect }[]): ConflictBadge[] {
  const placed: Rect[] = []
  const badges: ConflictBadge[] = []
  rows.sort((a, b) => a.box.y - b.box.y || b.box.x - a.box.x)
  for (const row of rows) {
    const step = PIN_HEIGHT_PX + GAP_PX
    let lift = 0
    const at = () => ({ ...row.box, y: row.box.y - lift })
    while (lift < MAX_LIFTS * step && placed.some((other) => overlaps(other, at()))) lift += step
    placed.push(at())
    for (const pin of row.pins) pin.head.y -= lift
    if (row.badge) {
      row.badge.y -= lift
      badges.push(row.badge)
    }
  }
  return badges
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function toScreenRect(camera: Camera, rect: Rect): Rect {
  const [x, y] = camera.toScreen(rect.x, rect.y)
  return { x, y, w: rect.w * camera.scale, h: rect.h * camera.scale }
}
