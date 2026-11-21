import { readFileSync } from 'node:fs'
import { writeAtomic } from '../indexer/cache.ts'
import { type Rect, WORLD_ID, type WorldNode } from '../shared/world.ts'
import { pack } from './pack.ts'

// Lays the world tree out bottom-up. Every container packs its children with
// the stable packer and remembers their reserved rectangles (relative to the
// container) in the layout store, so the map keeps its shape as code changes.

// parent id -> child id -> reserved rectangle.
export type LayoutStore = Map<string, Map<string, Rect>>

const SLACK = 1.12
// Files are square; their area grows with lines, plus a floor so that tiny
// files stay visible.
const FILE_FLOOR = 16

export function fileSide(lines: number): number {
  return Math.sqrt(Math.max(lines, 0) + FILE_FLOOR)
}

export function loadLayout(path: string): LayoutStore {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, Rect>>
    return new Map(
      Object.entries(raw).map(([parent, children]) => [parent, new Map(Object.entries(children))]),
    )
  } catch {
    return new Map()
  }
}

export function saveLayout(path: string, store: LayoutStore): void {
  const raw: Record<string, Record<string, Rect>> = {}
  for (const [parent, children] of store) raw[parent] = Object.fromEntries(children)
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
    const packed = pack(items, store.get(node.id) ?? new Map(), { gap, slack: SLACK })
    store.set(node.id, packed.reserved)
    const extent = Math.max(packed.width, packed.height, 4)
    const padX = Math.max(0.8, 0.025 * extent)
    const padY = Math.max(1.6, 0.06 * extent)
    const frame = {
      w: Math.max(packed.width, 4) + 2 * padX,
      h: Math.max(packed.height, 2) + padY + padX,
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
    const reserved = store.get(node.id)
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
