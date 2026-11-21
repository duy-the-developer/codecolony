import type { Edge, LineRange, SymbolKind, TransportFact } from '../core/model.ts'

// The map the server sends to the page: a tree of nodes with absolute
// rectangles, plus edges between node ids.

export type { Edge, EdgeKind, Provenance, SymbolKind } from '../core/model.ts'

export const WORLD_ID = 'world'

// A package is a band of modules: a folder with a package manifest, or the
// rest of its repository. A module is a folder that holds files directly.
export type NodeKind = 'world' | 'project' | 'repo' | 'package' | 'module' | 'file' | 'symbol'

// Rectangles are measured in grid squares: the page draws its background grid
// one unit apart, and every block edge falls on a grid line. Each container
// keeps a label strip this many units tall at its top.
export const HEADER_UNITS: Record<NodeKind, number> = {
  world: 0,
  project: 2,
  repo: 2,
  package: 2,
  module: 1,
  file: 0,
  symbol: 0,
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface WorldNode {
  id: string
  parent?: string
  kind: NodeKind
  name: string
  // Repository-relative path for packages, modules, files and symbols.
  path?: string
  lines: number
  complexity: number
  rect: Rect
  // file: adapter id, 'text' or 'binary'.
  language?: string
  // package: holds a package manifest (package.json, go.mod, Cargo.toml, ...).
  package?: boolean
  // repo: the indexed commit.
  commit?: string
  // symbol
  symbolKind?: SymbolKind
  range?: LineRange
  exported?: boolean
  // file: cross-process facts (HTTP, queues, data).
  transports?: TransportFact[]
}

export interface World {
  version: number
  indexedAt: string
  // Languages on the map, and whether a language server can trace them.
  languages: Record<string, { semantic: boolean }>
  nodes: WorldNode[]
  edges: Edge[]
}

export interface DeepResponse {
  edges: Edge[]
}
