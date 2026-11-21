import { EDGE_KINDS, type Edge, PROVENANCES, SYMBOL_KINDS } from '../core/model.ts'
import { applySplices } from './sequence-diff.ts'
import { symbolBand } from './symbol-band.ts'
import {
  AT_FROM,
  EDGE_STRIDE,
  NODE_KINDS,
  type NodeRow,
  type SymbolRow,
  type World,
  type WorldNode,
  type WorldResponse,
} from './world-types.ts'

// Turns the wire format (see world-encoder.ts) back into a World on the page:
// the world without symbols, then a file's symbols when they are loaded.

export interface WorldState {
  session: string
  // Nodes in wire order: a node's index is its index here and in rows.
  world: World
  rows: NodeRow[]
  strings: string[]
}

export class WorldDecodeError extends Error {
  override name = 'WorldDecodeError'
  readonly code: 'StaleBase'
  constructor(message: string, code: 'StaleBase', options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

// The world a response describes. A patch needs the state it was made from.
export function worldFromResponse(response: WorldResponse, base?: WorldState): WorldState {
  if (response.type === 'full') {
    const { nodes } = decodeNodes(response.nodes.map((row) => ({ row })))
    const { strings } = response
    const edges: Edge[] = []
    for (let at = 0; at < response.edges.length; at += EDGE_STRIDE) {
      edges.push(decodeEdge(response.edges, at, nodes, strings))
    }
    return {
      session: response.session,
      world: { ...worldHeader(response), nodes, edges },
      rows: response.nodes,
      strings,
    }
  }
  if (!base || base.session !== response.session || base.world.version !== response.base) {
    throw new WorldDecodeError('the patch does not apply to this world', 'StaleBase')
  }
  const strings = [...base.strings, ...response.strings]
  const sources = applySplices<NodeSource, NodeRow>(
    base.rows.map((row, old) => ({ row, old })),
    response.nodes,
    (row) => ({ row }),
  )
  const { nodes, rows } = decodeNodes(sources, base.world.nodes)
  const edges = applySplices(base.world.edges, response.edges, (item) =>
    decodeEdge(item, 0, nodes, strings),
  )
  return {
    session: response.session,
    world: { ...worldHeader(response), nodes, edges },
    rows,
    strings,
  }
}

// A file's symbols as nodes, placed over the file.
export function symbolsFromRows(file: WorldNode, rows: readonly SymbolRow[]): WorldNode[] {
  const nodes: (WorldNode | undefined)[] = new Array(rows.length)
  const build = (i: number): WorldNode => {
    const built = nodes[i]
    if (built) return built
    const [parent, qualified, name, kind, start, end, exported, complexity] = rows[i] as SymbolRow
    // A parent that is not in the list, or a loop, falls back to the file.
    nodes[i] = file
    const holder = parent >= 0 && parent < rows.length && parent !== i ? build(parent) : file
    const range = { start, end }
    const node: WorldNode = {
      id: `${file.id}#${qualified}`,
      parent: holder.id,
      kind: 'symbol',
      name: name ?? qualified,
      lines: end - start + 1,
      complexity,
      rect: symbolBand(range, file.rect, file.lines, holder === file ? undefined : holder.rect),
      symbolKind: SYMBOL_KINDS[kind] ?? 'function',
      range,
    }
    if (file.path !== undefined) node.path = file.path
    if (exported >= 0) node.exported = exported === 1
    nodes[i] = node
    return node
  }
  return rows.map((_, i) => build(i))
}

// A node row with, for a node kept from the base version, its index there.
interface NodeSource {
  row: NodeRow
  old?: number
}

function worldHeader(response: WorldResponse): Omit<World, 'nodes' | 'edges'> {
  return {
    version: response.version,
    indexedAt: response.indexedAt,
    languages: response.languages,
  }
}

// A kept row's parent index points into the base version, so it is found by
// the parent's id; a new row's parent index is already in this version.
function decodeNodes(
  sources: readonly NodeSource[],
  base?: readonly WorldNode[],
): { nodes: WorldNode[]; rows: NodeRow[] } {
  const nodes: WorldNode[] = []
  const rows: NodeRow[] = []
  const indexOf = new Map<string, number>()
  for (const source of sources) {
    let { row } = source
    const [parentIndex, kind, cut, tail, name, path, x, y, w, h] = row
    let parent: WorldNode | undefined
    if (source.old !== undefined && base) {
      const parentId = base[source.old]?.parent
      parent = parentId === undefined ? undefined : nodes[indexOf.get(parentId) ?? -1]
      const index = parent ? (indexOf.get(parent.id) as number) : -1
      if (index !== parentIndex) {
        row = [...row]
        row[0] = index
      }
    } else {
      parent = parentIndex >= 0 ? nodes[parentIndex] : undefined
    }
    const id = (parent?.id ?? '').slice(0, cut) + tail
    const node: WorldNode = {
      id,
      kind: NODE_KINDS[kind] ?? 'module',
      name: name ?? tail,
      lines: row[10],
      complexity: row[11],
      rect: { x: (parent?.rect.x ?? 0) + x, y: (parent?.rect.y ?? 0) + y, w, h },
    }
    if (parent) node.parent = parent.id
    if (typeof path === 'number') node.path = id.slice(path)
    else if (path !== null) node.path = path
    const extra = row[14]
    if (extra) Object.assign(node, extra)
    indexOf.set(id, nodes.push(node) - 1)
    rows.push(row)
  }
  return { nodes, rows }
}

function decodeEdge(
  data: readonly number[],
  at: number,
  nodes: readonly WorldNode[],
  strings: readonly string[],
): Edge {
  const field = (i: number) => data[at + i] as number
  const end = (node: number, symbol: number): string => {
    if (node < 0) return strings[symbol] ?? ''
    const id = nodes[node]?.id ?? ''
    return symbol < 0 ? id : `${id}#${strings[symbol] ?? ''}`
  }
  const code = field(4)
  const edge: Edge = {
    from: end(field(0), field(1)),
    to: end(field(2), field(3)),
    kind: EDGE_KINDS[code & 7] ?? 'import',
    provenance: PROVENANCES[(code >> 3) & 3] ?? 'inferred',
  }
  const label = field(5)
  if (label >= 0) edge.label = strings[label] ?? ''
  const atFile = field(6)
  if (atFile !== -1) {
    const file =
      atFile === AT_FROM
        ? (nodes[field(0)]?.id ?? '')
        : atFile <= -3
          ? (strings[-3 - atFile] ?? '')
          : (nodes[atFile]?.id ?? '')
    edge.at = { file, line: field(7) }
  }
  const typeOnly = (code >> 5) & 3
  if (typeOnly > 0) edge.typeOnly = typeOnly === 2
  return edge
}

// The symbol count and key of each node, by index.
export function symbolCountOf(state: WorldState, index: number): number {
  return state.rows[index]?.[12] ?? 0
}

export function symbolsKeyOf(state: WorldState, index: number): string {
  return state.rows[index]?.[13] ?? ''
}
