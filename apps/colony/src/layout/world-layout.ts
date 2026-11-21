import { readFileSync } from 'node:fs'
import { writeAtomic } from '../core/atomic-write.ts'
import {
  type Edge,
  HEADER_UNITS,
  type Rect,
  WORLD_ID,
  type WorldNode,
} from '../shared/world-types.ts'
import { fileUnits, naturalHeight, packCells } from './pack-cells.ts'
import { packRows, type RowItem, type StoredRow } from './pack-rows.ts'
import { rankItems } from './rank-items.ts'

// Lays the world tree out on the unit grid, bottom-up. Files are squares on
// their module's cell grid; modules, packages, repositories and projects sit
// in rows inside their parent (see pack-rows.ts). Files directly in a
// repository or package share one more cell grid in its rows, with no border
// or label of its own. Every size, padding and gap
// is a whole number of units, so every edge lands on a grid line. The order of
// children is remembered in the layout store, so the map keeps its shape as
// code changes.

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
  // Whole units between modules, and between packages. The dependency
  // overlay widens it to make room for its lanes.
  gutter: number
}

export const DEFAULT_LAYOUT: LayoutOptions = { gutter: 2 }

// Bumped when stored layouts can no longer be read as they are; version 2,
// whose repositories and packages kept their own files in a root module, is
// migrated, and older ones are dropped and the world is laid out afresh.
const STORE_VERSION = 3

interface StoredLayout {
  version: number
  rows: Record<string, StoredRow[]>
  modules: Record<string, StoredModule>
}

// Units of padding inside a container's left, right and bottom edges.
const PAD = 1
// A module is at least this many cells across, so its label has room.
const MIN_MODULE_CELLS = 2
// A module keeps the height its files pack to until they need this many
// times more or half as much.
const MODULE_REGROW = 1.5

// The row item that holds a container's own files. "#" only ever follows a
// file id elsewhere, so it cannot clash with a node id.
export function looseId(container: string): string {
  return `${container}#files`
}

export function emptyLayout(): LayoutStore {
  return { rows: new Map(), modules: new Map() }
}

export function loadLayout(path: string): LayoutStore {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredLayout>
    if (raw.version !== STORE_VERSION && raw.version !== 2) return emptyLayout()
    const store = {
      rows: new Map(Object.entries(raw.rows ?? {})),
      modules: new Map(Object.entries(raw.modules ?? {})),
    }
    return raw.version === 2 ? migrateRootModules(store) : store
  } catch {
    return emptyLayout()
  }
}

export function saveLayout(path: string, store: LayoutStore): void {
  const raw: StoredLayout = {
    version: STORE_VERSION,
    rows: Object.fromEntries(store.rows),
    modules: Object.fromEntries(store.modules),
  }
  writeAtomic(path, JSON.stringify(raw))
}

interface Sized {
  w: number
  h: number
  fit?: (h: number) => number
}

// Version 2 kept the modules outside any package in a "<repo>/package:."
// package, and the files of a repository's or package's own folder in a
// module of that folder. The root package's rows take its place in the
// repository's rows, and those modules become loose-file groups.
function migrateRootModules(old: LayoutStore): LayoutStore {
  const rows = new Map(old.rows)
  const renames = new Map<string, string>()
  for (const [id, own] of old.rows) {
    const marker = id.lastIndexOf('/package:')
    if (marker < 0) continue
    const repo = id.slice(0, marker)
    const pkg = id.slice(marker + '/package:'.length)
    if (pkg !== '.') {
      renames.set(`${repo}/${pkg}`, looseId(id))
      continue
    }
    renames.set(`${repo}/.`, looseId(repo))
    rows.delete(id)
    const outer = rows.get(repo) ?? []
    const at = outer.findIndex((row) => row.slots.some((slot) => slot.includes(id)))
    const rest = outer
      .map((row) => ({
        h: row.h,
        slots: row.slots.map((slot) => slot.filter((item) => item !== id)).filter((s) => s.length),
      }))
      .filter((row) => row.slots.length > 0)
    const keep = at < 0 ? rest.length : at
    rows.set(repo, [...rest.slice(0, keep), ...own, ...rest.slice(keep)])
  }
  const rename = (id: string) => renames.get(id) ?? id
  return {
    rows: new Map(
      [...rows].map(([id, list]) => [
        id,
        list.map((row) => ({ h: row.h, slots: row.slots.map((slot) => slot.map(rename)) })),
      ]),
    ),
    modules: new Map([...old.modules].map(([id, module]) => [rename(id), module])),
  }
}

// Fills node.rect for every node. Replaces the store's entries with the
// layout just made; entries for containers that are gone are dropped.
export function layoutWorld(
  nodes: WorldNode[],
  edges: readonly Edge[],
  store: LayoutStore,
  { gutter }: LayoutOptions = DEFAULT_LAYOUT,
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
    if (node.kind === 'module') {
      const { sizes, height } = packFiles(node.id, kids)
      const width = (h: number) =>
        Math.max(packCells(sizes, h - top - PAD).width, MIN_MODULE_CELLS) + 2 * PAD
      return { w: width(height + top + PAD), h: height + top + PAD, fit: width }
    }
    const loose = kids.filter((kid) => kid.kind === 'file')
    const blocks = kids.filter((kid) => kid.kind !== 'file')
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
      const width = (h: number) => packCells(sizes, h).width
      items.push({
        id: group,
        rank: ranks.get(group) ?? 0,
        w: width(height),
        h: height,
        fit: width,
      })
    }
    const gap = node.kind === 'world' ? 2 * gutter : gutter
    const packed = packRows(items, store.rows.get(node.id) ?? [], { gutter: gap })
    rows.set(node.id, packed.rows)
    placed.set(node.id, packed.placed)
    const pad = node.kind === 'world' ? 0 : PAD
    return { w: packed.width + 2 * pad, h: packed.height + top + pad }
  }

  const rootSize = size(root)
  store.rows = rows
  store.modules = modules

  // Packs a module's or group's files into the area at x, y, height tall.
  const placeFiles = (id: string, x: number, y: number, height: number): void => {
    const order = files.get(id) ?? []
    const { cells } = packCells(
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
    if (node.kind === 'module') {
      placeFiles(node.id, rect.x + PAD, rect.y + top, rect.h - top - PAD)
      return
    }
    if (node.kind === 'file') {
      for (const kid of children.get(node.id) ?? []) placeSymbol(kid, node, children)
      return
    }
    const pad = node.kind === 'world' ? 0 : PAD
    const kids = placed.get(node.id)
    for (const kid of children.get(node.id) ?? []) {
      if (kid.kind === 'file') continue
      const at = kids?.get(kid.id)
      if (at) place(kid, { x: rect.x + pad + at.x, y: rect.y + top + at.y, w: at.w, h: at.h })
    }
    const group = kids?.get(looseId(node.id))
    if (group) placeFiles(looseId(node.id), rect.x + pad + group.x, rect.y + top + group.y, group.h)
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

function moduleHeight(sizes: readonly number[], saved: number | undefined): number {
  const natural = naturalHeight(sizes)
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
