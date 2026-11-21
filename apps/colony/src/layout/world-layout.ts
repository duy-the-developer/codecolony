import { readFileSync } from 'node:fs'
import { writeAtomic } from '../core/atomic-write.ts'
import { type Rect, WORLD_ID, type WorldNode } from '../shared/world-types.ts'
import { pack } from './pack.ts'

// Lays the world tree out bottom-up. Every container packs its children with
// the stable packer and remembers their reserved rectangles (relative to the
// container) in the layout store, so the map keeps its shape as code changes.

export interface LayoutStore {
  // parent id -> child id -> reserved rectangle.
  slots: Map<string, Map<string, Rect>>
  // container id -> the padding it was given and the size that set it.
  pads: Map<string, Pad>
}

interface Pad {
  x: number
  y: number
  extent: number
}

interface StoredLayout {
  slots: Record<string, Record<string, Rect>>
  pads: Record<string, Pad>
}

export function emptyLayout(): LayoutStore {
  return { slots: new Map(), pads: new Map() }
}

const SLACK = 1.12
// Files are square; their area grows with lines, plus a floor so that tiny
// files stay visible.
const FILE_FLOOR = 16

export function fileSide(lines: number): number {
  return Math.sqrt(Math.max(lines, 0) + FILE_FLOOR)
}

export function loadLayout(path: string): LayoutStore {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredLayout>
    return {
      slots: new Map(
        Object.entries(raw.slots ?? {}).map(([parent, kids]) => [
          parent,
          new Map(Object.entries(kids)),
        ]),
      ),
      pads: new Map(Object.entries(raw.pads ?? {})),
    }
  } catch {
    return emptyLayout()
  }
}

export function saveLayout(path: string, store: LayoutStore): void {
  const raw: StoredLayout = { slots: {}, pads: Object.fromEntries(store.pads) }
  for (const [parent, kids] of store.slots) raw.slots[parent] = Object.fromEntries(kids)
  writeAtomic(path, JSON.stringify(raw))
}

interface Frame {
  w: number
  h: number
  // Offset of the content area inside the node.
  padX: number
  padY: number
}

// Fills node.rect for every node. Updates the store in place.
export function layoutWorld(nodes: WorldNode[], store: LayoutStore): void {
  const children = new Map<string, WorldNode[]>()
  const byId = new Map<string, WorldNode>()
  for (const node of nodes) {
    byId.set(node.id, node)
    if (!node.parent) continue
    const list = children.get(node.parent)
    if (list) list.push(node)
    else children.set(node.parent, [node])
  }
  const frames = new Map<string, Frame>()

  const size = (node: WorldNode): Frame => {
    if (node.kind === 'file') {
      const side = fileSide(node.lines)
      const frame = { w: side, h: side, padX: 0, padY: 0 }
      frames.set(node.id, frame)
      return frame
    }
    const kids = (children.get(node.id) ?? []).filter((kid) => kid.kind !== 'symbol')
    const items = kids.map((kid) => {
      const frame = size(kid)
      return { id: kid.id, w: frame.w, h: frame.h }
    })
    let area = 0
    for (const item of items) area += item.w * item.h
    const gap = Math.max(0.5, 0.06 * Math.sqrt(area / Math.max(items.length, 1)))
    const packed = pack(items, store.slots.get(node.id) ?? new Map(), { gap, slack: SLACK })
    store.slots.set(node.id, packed.reserved)
    // The container wraps what is drawn, not the spare room in reservations
    // or the places held for deleted children.
    let width = 0
    let height = 0
    for (const item of items) {
      const slot = packed.reserved.get(item.id)
      if (!slot) continue
      width = Math.max(width, slot.x + item.w)
      height = Math.max(height, slot.y + item.h)
    }
    // Padding scales with the container but is kept until the container has
    // halved or doubled, so ordinary growth does not nudge every child.
    const extent = Math.max(width, height, 4)
    let pad = store.pads.get(node.id)
    if (!pad || extent > 2 * pad.extent || extent < pad.extent / 2) {
      pad = { x: Math.max(0.8, 0.025 * extent), y: Math.max(1.6, 0.06 * extent), extent }
      store.pads.set(node.id, pad)
    }
    const padX = pad.x
    const padY = pad.y
    const frame = {
      w: Math.max(width, 4) + 2 * padX,
      h: Math.max(height, 2) + padY + padX,
      padX,
      padY,
    }
    frames.set(node.id, frame)
    return frame
  }

  const root = byId.get(WORLD_ID)
  if (!root) throw new Error('world node missing')
  size(root)

  const place = (node: WorldNode, x: number, y: number): void => {
    const frame = frames.get(node.id)
    if (!frame) return
    node.rect = { x, y, w: frame.w, h: frame.h }
    const reserved = store.slots.get(node.id)
    for (const kid of children.get(node.id) ?? []) {
      if (kid.kind === 'symbol') {
        placeSymbol(kid, node, children)
        continue
      }
      const slot = reserved?.get(kid.id)
      if (slot) place(kid, x + frame.padX + slot.x, y + frame.padY + slot.y)
    }
  }
  place(root, 0, 0)
}

// Symbols are drawn as bands over their file: the vertical position and
// height follow their line range, so the band shows where the code sits.
function placeSymbol(
  symbol: WorldNode,
  holder: WorldNode,
  children: Map<string, WorldNode[]>,
  file: WorldNode = holder,
): void {
  const range = symbol.range
  if (!range) return
  const inset = 0.08 * Math.min(file.rect.w, file.rect.h)
  const top = file.rect.y + inset
  const height = file.rect.h - 2 * inset
  const lines = Math.max(file.lines, 1)
  const y = top + ((range.start - 1) / lines) * height
  const h = Math.max(((range.end - range.start + 1) / lines) * height, height / Math.max(lines, 40))
  const x = holder === file ? file.rect.x + inset : holder.rect.x + 0.08 * holder.rect.w
  const w = holder === file ? file.rect.w - 2 * inset : 0.88 * holder.rect.w
  symbol.rect = { x, y, w, h }
  for (const kid of children.get(symbol.id) ?? []) placeSymbol(kid, symbol, children, file)
}
