import { buildChannelGraph, type ChannelGraph } from '../shared/channel-graph.ts'
import { buildRouteBoxes, type RouteBoxes, type RouteNode } from '../shared/route-boxes.ts'
import { type Link, routeLanes } from '../shared/route-lanes.ts'

// The Dependency overlay's routing for one world version, run in a worker
// (lane-worker.ts) so routing a large world never stalls the map. A level is
// a set of open containers (link-cache.ts): closed ones are blocks of their
// own, so links merge into them as the map zooms out.

// An import edge, by the ids of its ends.
export type LaneEdge = readonly [from: string, to: string]

export interface LaneLevel {
  // Links between blocks, one per importing and imported block.
  links: Link[]
  // Per import edge (in the order given to LaneWorld), its link, or -1 when
  // both ends fall in one block.
  linkOfEdge: Int32Array
}

export interface LaneRoutes {
  // The links routed, as indices into LaneLevel.links.
  links: Int32Array
  // Each routed link's corner points x0, y0, x1, y1, ... are
  // points[offsets[i]] up to points[offsets[i + 1]]; empty when it has no path.
  points: Float64Array
  offsets: Int32Array
  // Links that shared a lane with another, summed over channels.
  merged: number
  // Lanes that did not fit on whole units, so sit closer than one apart.
  crowded: number
  routeMs: number
}

// Levels kept in memory.
const MAX_LEVELS = 8
// Merge levels walk this many folders up from the imported block at most.
const MAX_MERGE_LEVEL = 32

interface Level {
  boxes: RouteBoxes
  graph: ChannelGraph
  level: LaneLevel
}

export class LaneWorld {
  private readonly nodes: readonly RouteNode[]
  private readonly edges: readonly LaneEdge[]
  private readonly parentOf = new Map<string, string>()
  private readonly levels = new Map<string, Level>()

  constructor(nodes: readonly RouteNode[], edges: readonly LaneEdge[]) {
    this.nodes = nodes
    this.edges = edges
    for (const node of nodes) if (node.parent) this.parentOf.set(node.id, node.parent)
  }

  // The links of the level with these open containers, kept under key.
  describeLevel(key: string, open: readonly string[]): LaneLevel {
    return this.resolveLevel(key, open).level
  }

  // Routes the level's links, or only some of them.
  route(key: string, open: readonly string[], only?: readonly number[]): LaneRoutes {
    const started = performance.now()
    const { graph, level } = this.resolveLevel(key, open)
    const picked = only ? [...only] : level.links.map((_, i) => i)
    const links = picked.map((i) => level.links[i] as Link)
    const routing = routeLanes(graph, links, {
      merge: 'whenFull',
      mergeKey: (link, depth) => this.mergeKey((links[link] as Link).to, depth),
    })
    const offsets = new Int32Array(picked.length + 1)
    let total = 0
    routing.points.forEach((points, i) => {
      total += points?.length ?? 0
      offsets[i + 1] = total
    })
    const points = new Float64Array(total)
    routing.points.forEach((p, i) => {
      if (p) points.set(p, offsets[i] as number)
    })
    return {
      links: Int32Array.from(picked),
      points,
      offsets,
      merged: routing.merged,
      crowded: routing.crowded,
      routeMs: performance.now() - started,
    }
  }

  // Links share a lane by imported block first, then by each folder above it.
  private mergeKey(block: string, depth: number): string | undefined {
    if (depth > MAX_MERGE_LEVEL) return undefined
    if (depth === 1) return block
    // A container's own files merge into that container first.
    const hash = block.indexOf('#')
    let id = hash < 0 ? block : block.slice(0, hash)
    for (let up = hash < 0 ? 1 : 2; up < depth; up++) id = this.parentOf.get(id) ?? id
    return id
  }

  private resolveLevel(key: string, open: readonly string[]): Level {
    let found = this.levels.get(key)
    if (found) {
      this.levels.delete(key)
    } else {
      const isOpen = new Set(open)
      const boxes = buildRouteBoxes(this.nodes, (id) => isOpen.has(id))
      const graph = boxes.root
        ? buildChannelGraph(boxes.root)
        : { channels: [], attachments: [], blockAttachments: new Map(), stuck: 0 }
      found = { boxes, graph, level: buildLevel(this.edges, boxes) }
      if (this.levels.size >= MAX_LEVELS) {
        const oldest = this.levels.keys().next().value
        if (oldest !== undefined) this.levels.delete(oldest)
      }
    }
    this.levels.set(key, found)
    return found
  }
}

function buildLevel(edges: readonly LaneEdge[], boxes: RouteBoxes): LaneLevel {
  const links: Link[] = []
  const index = new Map<string, number>()
  const linkOfEdge = new Int32Array(edges.length).fill(-1)
  edges.forEach(([from, to], e) => {
    const a = boxes.blockOf(from)
    const b = boxes.blockOf(to)
    if (!a || !b || a === b) return
    const key = `${a}\n${b}`
    let link = index.get(key)
    if (link === undefined) {
      link = links.push({ from: a, to: b }) - 1
      index.set(key, link)
    }
    linkOfEdge[e] = link
  })
  return { links, linkOfEdge }
}
