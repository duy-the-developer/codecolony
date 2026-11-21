import type { Edge, EdgeKind, WorldNode } from '../shared/world-types.ts'
import type { Scene } from './scene.ts'

// The inspector's dependency lists for a selection: every edge that leaves or
// enters it, grouped by kind and direction under engineering names.

export type EdgeDirection = 'out' | 'in'

export interface EdgeRow {
  edge: Edge
  // The node at the other end, if it is on the map and loaded: a symbol of a
  // file whose symbols are not loaded yet has only its id.
  other: WorldNode | undefined
  otherId: string
  // How many edges share this kind, other end and provenance.
  count: number
}

export interface EdgeSection {
  kind: EdgeKind
  direction: EdgeDirection
  title: string
  rows: EdgeRow[]
  total: number
}

export const EDGE_SECTION_TITLES: Record<EdgeKind, Record<EdgeDirection, string>> = {
  import: { out: 'Imports', in: 'Imported by' },
  call: { out: 'Calls', in: 'Called by' },
  http: { out: 'HTTP requests', in: 'HTTP routes served' },
  queue: { out: 'Publishes to', in: 'Consumes from' },
  data: { out: 'Reads and writes', in: 'Read and written by' },
}

const SECTION_ORDER: readonly EdgeKind[] = ['import', 'call', 'http', 'queue', 'data']

// subtree: the selected node and everything inside it. Edges inside the
// selection are left out.
export function listEdgeSections(scene: Scene, subtree: ReadonlySet<string>): EdgeSection[] {
  const buckets = new Map<string, Edge[]>()
  for (const edge of scene.edges) {
    const fromInside = subtree.has(edge.from)
    const toInside = subtree.has(edge.to)
    if (fromInside === toInside) continue
    const key = `${edge.kind}|${fromInside ? 'out' : 'in'}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(edge)
    else buckets.set(key, [edge])
  }
  const sections: EdgeSection[] = []
  for (const kind of SECTION_ORDER) {
    for (const direction of ['out', 'in'] as const) {
      const edges = buckets.get(`${kind}|${direction}`)
      if (!edges) continue
      sections.push({
        kind,
        direction,
        title: EDGE_SECTION_TITLES[kind][direction],
        rows: groupRows(scene, edges, direction),
        total: edges.length,
      })
    }
  }
  return sections
}

// One row per other end, label and provenance, most frequent first.
function groupRows(scene: Scene, edges: Edge[], direction: EdgeDirection): EdgeRow[] {
  const end = direction === 'out' ? 'to' : 'from'
  const groups = new Map<string, EdgeRow>()
  for (const edge of edges) {
    const key = `${edge[end]}|${edge.kind === 'http' ? edge.label : ''}|${edge.provenance}`
    const group = groups.get(key)
    if (group) group.count++
    else groups.set(key, { edge, other: scene.byId.get(edge[end]), otherId: edge[end], count: 1 })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

// How a row names its other end: a path for files and folders, `name (file)`
// for symbols, and the route first for HTTP.
export function describeEdgeRow(scene: Scene, row: EdgeRow, direction: EdgeDirection): string {
  const target = describeNode(scene, row.other, row.otherId)
  if (row.edge.kind !== 'http' || !row.edge.label) return target
  return direction === 'out' ? `${row.edge.label} → ${target}` : `${row.edge.label} ← ${target}`
}

function describeNode(scene: Scene, node: WorldNode | undefined, id: string): string {
  if (!node) {
    // Not loaded: the name is the last part of the symbol's qualified name.
    const file = scene.byId.get(scene.fileIdOf(id) ?? '')
    if (!file) return '(outside the map)'
    const qualified = id.slice(file.id.length + 1)
    return `${qualified.slice(qualified.lastIndexOf('.') + 1)} (${file.name})`
  }
  if (node.kind !== 'symbol') return node.path ?? node.name
  const file = node.id.slice(0, node.id.indexOf('#'))
  return `${node.name} (${scene.byId.get(file)?.name ?? ''})`
}
