import type { Edge, LineRange, SymbolKind, TransportFact } from './facts.ts'

// The map the server sends to the page: a tree of nodes with absolute
// rectangles, plus edges between node ids.

export type { Edge, EdgeKind, LineRange, Provenance, SymbolKind } from './facts.ts'

export const WORLD_ID = 'world'

// A package is a band of modules: a folder below its repository's root with a
// package manifest. A module is a folder that holds files, or subfolders'
// modules, inside its package or repository. Files in a repository's or
// package's own folder sit directly in it, outside any module.
export const NODE_KINDS = [
  'world',
  'project',
  'repo',
  'package',
  'module',
  'file',
  'symbol',
] as const
export type NodeKind = (typeof NODE_KINDS)[number]

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
  // repo, package: holds a package manifest (package.json, go.mod, Cargo.toml, ...).
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

// The wire format. The page never receives a World: it receives the world
// without symbols, with nodes referred to by their index in this version, and
// fetches a file's symbols when the file opens. See wire/world-encoder.ts.

// A node other than a symbol, as a row:
// [parent, kind, idCut, idTail, name, path, x, y, w, h, lines, complexity,
//  symbols, symbolsKey, extra]
// - parent: index of the parent node, -1 for the root. Parents come first.
// - kind: index into NODE_KINDS.
// - id: the parent's id cut to idCut characters, then idTail.
// - name: null when it equals idTail.
// - path: a number n means id.slice(n); null means none.
// - x, y: relative to the parent's x, y; w, h: size. Quantized, see RECT_QUANTUM.
// - symbols: how many symbols /api/symbols returns for this file.
// - symbolsKey: changes whenever those symbols change; '' without symbols.
export type NodeRow = [
  parent: number,
  kind: number,
  idCut: number,
  idTail: string,
  name: string | null,
  path: number | string | null,
  x: number,
  y: number,
  w: number,
  h: number,
  lines: number,
  complexity: number,
  symbols: number,
  symbolsKey: string,
  extra: NodeExtra | null,
]

export type NodeExtra = Pick<WorldNode, 'language' | 'package' | 'commit' | 'transports'>

// Edges are a flat number array, EDGE_STRIDE numbers per edge:
// [from, fromSymbol, to, toSymbol, code, label, atFile, line]
// - from, to: node index. With a symbol, the string index of its qualified
//   name: the end is `${node id}#${name}`. A symbol of -1 means the node
//   itself. A node of -1 means an id outside the map, given in full by the
//   symbol string.
// - code: edge kind index | provenance index << 3 | typeOnly << 5, where
//   typeOnly is 0 when absent, 1 for false and 2 for true.
// - label: string index, or -1.
// - atFile: node index of at.file; AT_FROM when it is the from node; -1
//   without `at`. line: at.line, or 0 without `at`.
export const EDGE_STRIDE = 8
export const AT_FROM = -2

// Rectangles are rounded to multiples of 1 / RECT_QUANTUM, a power of two, so
// sums and differences of them are exact.
export const RECT_QUANTUM = 256

// GET /api/world: the whole world.
export interface WorldPayload {
  type: 'full'
  // Changes when the server restarts; versions only count within a session.
  session: string
  version: number
  indexedAt: string
  languages: World['languages']
  // The string table that edges and symbols refer to.
  strings: string[]
  nodes: NodeRow[]
  edges: number[]
}

// Replace deleteCount items at index `at` of the base version with these.
export type Splice<T> = [at: number, deleteCount: number, items: T[]]

// GET /api/world?session=S&since=V: what changed since version V, when the
// server still knows V. Splices apply in order to the base version's lists;
// node rows refer to node indices of the new version.
export interface WorldPatch {
  type: 'patch'
  session: string
  base: number
  version: number
  indexedAt: string
  languages: World['languages']
  // Appended to the base version's string table.
  strings: string[]
  nodes: Splice<NodeRow>[]
  // Each item is EDGE_STRIDE numbers, as in WorldPayload.edges.
  edges: Splice<number[]>[]
}

export type WorldResponse = WorldPayload | WorldPatch

// A symbol of a file, as a row:
// [parent, qualified, name, kind, start, end, exported, complexity]
// - parent: index of the enclosing symbol in the same list, or -1 for the file.
// - qualified: the id is `${file id}#${qualified}`.
// - name: null when it equals qualified.
// - kind: index into SYMBOL_KINDS. exported: 1, 0, or -1 when unknown.
// Rectangles are not sent: they follow from the file's (layout/symbol-band.ts).
export type SymbolRow = [
  parent: number,
  qualified: string,
  name: string | null,
  kind: number,
  start: number,
  end: number,
  exported: number,
  complexity: number,
]

// GET /api/symbols?session=S&version=V&files=i,j: the symbols of the files at
// those node indices of version V in session S. Any other version or session
// is refused with 409.
export interface SymbolsResponse {
  version: number
  files: Record<number, SymbolRow[]>
}
