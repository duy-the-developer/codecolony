import type { BlockSide } from '../lane-routing/channel-graph.ts'
import { looseId } from '../lane-routing/route-boxes.ts'
import {
  type Edge,
  HEADER_UNITS,
  type Rect,
  WORLD_ID,
  type WorldNode,
} from '../world/world-types.ts'
import { type LaneWidening, resolveLaneWidening } from './lane-widening.ts'
import { type CellPacking, fileUnits, naturalHeight, packCells } from './pack-cells.ts'
import { packRows, type RowItem, type StoredRow } from './pack-rows.ts'
import { symbolBand } from './symbol-band.ts'

export type { StoredRow } from './pack-rows.ts'

import { rankItems } from './rank-items.ts'

// Lays the world tree out on the unit grid, bottom-up. Files are squares on
// their module's cell grid, a 1-unit street apart, so lanes can run between
// them; modules, packages, repositories and projects sit in rows inside their
// parent (see pack-rows.ts). A module with subfolders
// lays its subfolders' modules out in rows the same way. Files directly in a
// repository, package or such a module share one more cell grid in its rows,
// with no border or label of its own. Every size, padding and gap is a whole
// number of units, so every edge lands on a grid line. The order of children
// is remembered in the layout store, so the map keeps its shape as code
// changes. Gutters then widen, a whole unit at a time, to make room for the
// Dependency overlay's lanes (see lane-widening.ts).

export interface LayoutStore {
  // container id -> its rows of child ids.
  rows: Map<string, StoredRow[]>
  // module id, or loose-file group id (see looseId) -> the order of its files
  // and the height they pack to.
  modules: Map<string, StoredModule>
}

export interface StoredModule {
  files: string[]
  h: number
}

export interface LayoutOptions {
  // Whole units between modules, and between packages.
  gutter: number
  // The widest a gutter grows, in units, to fit the Dependency overlay's
  // lanes one unit apart (8 by default). At gutter or less, gutters keep
  // their width.
  maxGutter?: number
}

export const DEFAULT_LAYOUT: LayoutOptions = { gutter: 2 }
const DEFAULT_MAX_GUTTER = 8
// Times the gutters are measured and widened. Lanes still short after the
// last round share lanes on the page.
const WIDEN_ROUNDS = 2

// Units of padding inside a container's edges, below its label strip. A
// folder's padding holds its ring of lanes (see lane-widening.ts) and grows
// on each side to fit them.
const PAD = 1
// Units of street between neighbouring files. It never widens, so files keep
// their places whatever imports change.
const FILE_STREET = 1
// A module is at least this many cells across, so its label has room.
const MIN_MODULE_CELLS = 2
// A module keeps the height its files pack to until they need this many
// times more or half as much.
const MODULE_REGROW = 1.5

export function emptyLayout(): LayoutStore {
  return { rows: new Map(), modules: new Map() }
}

interface Sized {
  w: number
  h: number
  fit?: (h: number) => number
}

// Fills node.rect for every node. Replaces the store's entries with the
// layout just made; entries for containers that are gone are dropped.
export function layoutWorld(
  nodes: WorldNode[],
  edges: readonly Edge[],
  store: LayoutStore,
  { gutter, maxGutter = DEFAULT_MAX_GUTTER }: LayoutOptions = DEFAULT_LAYOUT,
): void {
  if (!Number.isInteger(gutter) || gutter < 1) {
    throw new RangeError(`gutter must be a whole number of units, got ${gutter}`)
  }
  const children = new Map<string, WorldNode[]>()
  const byId = new Map<string, WorldNode>()
  for (const node of nodes) {
    byId.set(node.id, node)
    if (!node.parent) continue
    const list = children.get(node.parent)
    if (list) list.push(node)
    else children.set(node.parent, [node])
  }
  const root = byId.get(WORLD_ID)
  if (!root) throw new Error('world node missing')
  const graphs = buildGraphs(edges, byId)
  const widening: LaneWidening = new Map()
  for (let round = 0; ; round++) {
    layOut(root, children, graphs, store, gutter, widening)
    if (round === WIDEN_ROUNDS || maxGutter <= gutter) return
    if (!resolveLaneWidening(nodes, edges, store.rows, maxGutter, widening)) return
  }
}

// One pass over the tree: sizes every container bottom-up, then places every
// node top-down. Reads the saved order from the store and writes the new one.
function layOut(
  root: WorldNode,
  children: ReadonlyMap<string, WorldNode[]>,
  graphs: ReadonlyMap<string, Map<string, Set<string>>>,
  store: LayoutStore,
  gutter: number,
  widening: LaneWidening,
): void {
  const rows = new Map<string, StoredRow[]>()
  const modules = new Map<string, StoredModule>()
  // Child rectangles relative to their container's content area, and the
  // files of each module and loose-file group in packing order.
  const placed = new Map<string, Map<string, Rect>>()
  const files = new Map<string, WorldNode[]>()

  // Orders a module's or group's files and picks the height they pack to.
  const packFiles = (id: string, kids: readonly WorldNode[]) => {
    const order = fileOrder(kids, store.modules.get(id))
    files.set(id, order)
    const sizes = order.map((file) => fileUnits(file.lines))
    const height = moduleHeight(sizes, store.modules.get(id)?.h)
    modules.set(id, { files: order.map((file) => file.id), h: height })
    return { sizes, height }
  }

  const size = (node: WorldNode): Sized => {
    if (node.kind === 'file') {
      const units = fileUnits(node.lines)
      return { w: units, h: units }
    }
    const kids = (children.get(node.id) ?? []).filter((kid) => kid.kind !== 'symbol')
    const top = HEADER_UNITS[node.kind]
    const loose = kids.filter((kid) => kid.kind === 'file')
    const blocks = kids.filter((kid) => kid.kind !== 'file')
    if (node.kind === 'module' && blocks.length === 0) {
      const { sizes, height } = packFiles(node.id, kids)
      const width = (h: number) =>
        Math.max(packFileCells(sizes, h - top - 2 * PAD).width, MIN_MODULE_CELLS) + 2 * PAD
      return { w: width(height + top + 2 * PAD), h: height + top + 2 * PAD, fit: width }
    }
    const group = looseId(node.id)
    const ids = blocks.map((kid) => kid.id)
    if (loose.length > 0) ids.push(group)
    const ranks = rankItems(ids, liftFiles(graphs.get(node.id), loose, group))
    const items: RowItem[] = []
    for (const kid of blocks) {
      const sized = size(kid)
      const item: RowItem = { id: kid.id, rank: ranks.get(kid.id) ?? 0, w: sized.w, h: sized.h }
      if (sized.fit) item.fit = sized.fit
      items.push(item)
    }
    if (loose.length > 0) {
      const { sizes, height } = packFiles(group, loose)
      const width = (h: number) => packFileCells(sizes, h).width
      items.push({
        id: group,
        rank: ranks.get(group) ?? 0,
        w: width(height),
        h: height,
        fit: width,
      })
    }
    const gap = node.kind === 'world' ? 2 * gutter : gutter
    const widen = widening.get(node.id)
    const packed = packRows(items, store.rows.get(node.id) ?? [], {
      gutter: gap,
      ...(widen ? { widen } : {}),
    })
    rows.set(node.id, packed.rows)
    placed.set(node.id, packed.placed)
    const pad = padOf(node)
    return { w: packed.width + pad.left + pad.right, h: packed.height + top + pad.top + pad.bottom }
  }

  // A container's padding on each side.
  const padOf = (node: WorldNode): Record<BlockSide, number> => {
    if (node.kind === 'world') return { top: 0, right: 0, bottom: 0, left: 0 }
    const ring = widening.get(node.id)?.ring
    return {
      top: PAD + (ring?.top ?? 0),
      right: PAD + (ring?.right ?? 0),
      bottom: PAD + (ring?.bottom ?? 0),
      left: PAD + (ring?.left ?? 0),
    }
  }

  const rootSize = size(root)
  store.rows = rows
  store.modules = modules

  // Packs a module's or group's files into the area at x, y, height tall.
  const placeFiles = (id: string, x: number, y: number, height: number): void => {
    const order = files.get(id) ?? []
    const { cells } = packFileCells(
      order.map((file) => fileUnits(file.lines)),
      height,
    )
    order.forEach((file, i) => {
      const cell = cells[i] as { x: number; y: number }
      const units = fileUnits(file.lines)
      place(file, { x: x + cell.x, y: y + cell.y, w: units, h: units })
    })
  }

  const place = (node: WorldNode, rect: Rect): void => {
    node.rect = rect
    const top = HEADER_UNITS[node.kind]
    if (node.kind === 'module' && !placed.has(node.id)) {
      placeFiles(node.id, rect.x + PAD, rect.y + top + PAD, rect.h - top - 2 * PAD)
      return
    }
    if (node.kind === 'file') {
      for (const kid of children.get(node.id) ?? []) placeSymbol(kid, node, children)
      return
    }
    const pad = padOf(node)
    const x = rect.x + pad.left
    const y = rect.y + top + pad.top
    const kids = placed.get(node.id)
    for (const kid of children.get(node.id) ?? []) {
      if (kid.kind === 'file') continue
      const at = kids?.get(kid.id)
      if (at) place(kid, { x: x + at.x, y: y + at.y, w: at.w, h: at.h })
    }
    const group = kids?.get(looseId(node.id))
    if (group) placeFiles(looseId(node.id), x + group.x, y + group.y, group.h)
  }
  place(root, { x: 0, y: 0, w: rootSize.w, h: rootSize.h })
}

// Files keep their saved order; new files follow, largest first.
function fileOrder(kids: readonly WorldNode[], saved: StoredModule | undefined): WorldNode[] {
  const byId = new Map(kids.map((kid) => [kid.id, kid]))
  const order: WorldNode[] = []
  for (const id of saved?.files ?? []) {
    const file = byId.get(id)
    if (!file) continue
    order.push(file)
    byId.delete(id)
  }
  const fresh = [...byId.values()].sort(
    (a, b) => b.lines - a.lines || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return [...order, ...fresh]
}

// A container's item graph with its loose files merged into their group.
function liftFiles(
  graph: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  loose: readonly WorldNode[],
  group: string,
): Map<string, Set<string>> {
  const ids = new Set(loose.map((file) => file.id))
  const lift = (id: string) => (ids.has(id) ? group : id)
  const lifted = new Map<string, Set<string>>()
  for (const [from, targets] of graph ?? []) {
    const set = lifted.get(lift(from)) ?? new Set()
    for (const to of targets) set.add(lift(to))
    lifted.set(lift(from), set)
  }
  return lifted
}

// Packs files into columns `height` tall with a street after each, trimmed at
// the far edges, so files sit FILE_STREET apart and flush with the area.
function packFileCells(sizes: readonly number[], height: number): CellPacking {
  const packed = packCells(
    sizes.map((size) => size + FILE_STREET),
    height + FILE_STREET,
  )
  return { cells: packed.cells, width: Math.max(0, packed.width - FILE_STREET) }
}

// The height files pack to, with streets between them.
function moduleHeight(sizes: readonly number[], saved: number | undefined): number {
  const cells = sizes.map((size) => size + FILE_STREET)
  const natural = Math.max(1, naturalHeight(cells) - FILE_STREET)
  if (saved === undefined || natural > MODULE_REGROW * saved || 2 * natural < saved) return natural
  return Math.max(saved, Math.max(1, ...sizes))
}

// Edges between files, lifted to the two children of their lowest common
// container: container id -> item graph between its children.
function buildGraphs(
  edges: readonly Edge[],
  byId: ReadonlyMap<string, WorldNode>,
): Map<string, Map<string, Set<string>>> {
  const graphs = new Map<string, Map<string, Set<string>>>()
  const chains = new Map<string, string[]>()
  // Ids from the world root down to the file that holds id.
  const chainOf = (id: string): string[] | undefined => {
    const hash = id.indexOf('#')
    const fileId = hash < 0 ? id : id.slice(0, hash)
    let chain = chains.get(fileId)
    if (chain) return chain
    chain = []
    for (let node = byId.get(fileId); node; node = node.parent ? byId.get(node.parent) : undefined)
      chain.push(node.id)
    if (chain.length === 0) return undefined
    chain.reverse()
    chains.set(fileId, chain)
    return chain
  }
  for (const edge of edges) {
    if (edge.kind === 'call') continue
    const from = chainOf(edge.from)
    const to = chainOf(edge.to)
    if (!from || !to) continue
    let depth = 0
    while (depth < from.length && depth < to.length && from[depth] === to[depth]) depth++
    const a = from[depth]
    const b = to[depth]
    const container = from[depth - 1]
    if (!a || !b || !container) continue
    let graph = graphs.get(container)
    if (!graph) {
      graph = new Map()
      graphs.set(container, graph)
    }
    let targets = graph.get(a)
    if (!targets) {
      targets = new Set()
      graph.set(a, targets)
    }
    targets.add(b)
  }
  return graphs
}

// Symbols are drawn as bands over their file (symbol-band.ts).
function placeSymbol(
  symbol: WorldNode,
  holder: WorldNode,
  children: ReadonlyMap<string, WorldNode[]>,
  file: WorldNode = holder,
): void {
  const range = symbol.range
  if (!range) return
  symbol.rect = symbolBand(range, file.rect, file.lines, holder === file ? undefined : holder.rect)
  for (const kid of children.get(symbol.id) ?? []) placeSymbol(kid, symbol, children, file)
}
