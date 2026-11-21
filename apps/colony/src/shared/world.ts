import type { Edge, LineRange, SymbolKind, TransportFact } from '../core/model.ts'

// The map the server sends to the page: a tree of nodes with absolute
// rectangles, plus edges between node ids.

export type { Edge, EdgeKind, Provenance, SymbolKind } from '../core/model.ts'

export const WORLD_ID = 'world'

export type NodeKind = 'world' | 'project' | 'repo' | 'dir' | 'file' | 'symbol'

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
  // Repository-relative path for dirs, files and symbols.
  path?: string
  lines: number
  complexity: number
  rect: Rect
  // file: adapter id, 'text' or 'binary'.
  language?: string
  // dir: holds a package manifest (package.json, go.mod, Cargo.toml, ...).
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
