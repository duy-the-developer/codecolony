import type { Attachment, Channel, ChannelGraph } from './channel-graph.ts'
import type { Link } from './route-lanes.ts'

// The search graph over a channel graph (channel-graph.ts) that dependency
// lines find their paths in, and the shortest-path search over it.

// Path cost of one bend, in grid units.
export const BEND_COST = 2

// The channel a link runs in between two consecutive attachments: the one
// both touch, as bar or as stem.
export function channelBetween(attachments: readonly Attachment[], a: number, b: number): number {
  const first = attachments[a] as Attachment
  const second = attachments[b] as Attachment
  if (first.bar === second.bar || first.bar === second.channel) return first.bar
  return first.channel as number
}

// Nodes: two per attachment, one on its bar (2a) and one on its stem (2a + 1),
// a channel end or a block side. Edges run along each channel between the
// nodes on it, and across each attachment.
export interface SearchGraph {
  // Compressed adjacency.
  offsets: Int32Array
  targets: Int32Array
  costs: Float64Array
  // Per node, the span in the box tree (see BoxNest) of the container its
  // channel was cut in, or -1 for a block side.
  nodeOrder: Int32Array
  nodeEnd: Int32Array
  // Per node, where it lies: a bar node on the bar's middle line, a stem node
  // at its mouth. Every edge costs at least the distance between its ends.
  nodeX: Float64Array
  nodeY: Float64Array
}

// Each channel graph's search graph, built on first use: a level routes the
// same graph again for every new focus.
const searchGraphs = new WeakMap<ChannelGraph, SearchGraph>()

export function resolveSearchGraph(graph: ChannelGraph): SearchGraph {
  let search = searchGraphs.get(graph)
  if (!search) {
    search = buildSearchGraph(graph)
    searchGraphs.set(graph, search)
  }
  return search
}

function buildSearchGraph(graph: ChannelGraph): SearchGraph {
  const { channels, attachments } = graph
  const onChannel: { node: number; pos: number }[][] = channels.map(() => [])
  const pairs: [number, number, number][] = []
  attachments.forEach((a, i) => {
    const bar = channels[a.bar] as Channel
    onChannel[a.bar]?.push({ node: 2 * i, pos: (a.from + a.to) / 2 })
    if (a.channel !== undefined) {
      const stem = channels[a.channel] as Channel
      onChannel[a.channel]?.push({ node: 2 * i + 1, pos: a.end === 0 ? stem.start : stem.end })
    }
    pairs.push([2 * i, 2 * i + 1, Math.abs((bar.low + bar.high) / 2 - a.mouth) + BEND_COST])
  })
  for (const list of onChannel) {
    list.sort((p, q) => p.pos - q.pos)
    for (let k = 0; k + 1 < list.length; k++) {
      const p = list[k] as { node: number; pos: number }
      const q = list[k + 1] as { node: number; pos: number }
      pairs.push([p.node, q.node, q.pos - p.pos])
    }
  }
  const nodes = 2 * attachments.length
  const offsets = new Int32Array(nodes + 1)
  for (const [a, b] of pairs) {
    offsets[a + 1] = (offsets[a + 1] as number) + 1
    offsets[b + 1] = (offsets[b + 1] as number) + 1
  }
  for (let n = 0; n < nodes; n++)
    offsets[n + 1] = (offsets[n + 1] as number) + (offsets[n] as number)
  const fill = offsets.slice(0, nodes)
  const targets = new Int32Array(2 * pairs.length)
  const costs = new Float64Array(2 * pairs.length)
  const add = (from: number, to: number, cost: number) => {
    const at = fill[from] as number
    fill[from] = at + 1
    targets[at] = to
    costs[at] = cost
  }
  for (const [a, b, cost] of pairs) {
    add(a, b, cost)
    add(b, a, cost)
  }
  const nodeOrder = new Int32Array(nodes)
  const nodeEnd = new Int32Array(nodes)
  const put = (node: number, c: number | undefined) => {
    const nest = c === undefined ? undefined : graph.nest.get((channels[c] as Channel).container)
    nodeOrder[node] = nest ? nest.order : -1
    nodeEnd[node] = nest ? nest.end : -1
  }
  const nodeX = new Float64Array(nodes)
  const nodeY = new Float64Array(nodes)
  attachments.forEach((a, i) => {
    put(2 * i, a.bar)
    put(2 * i + 1, a.channel)
    const bar = channels[a.bar] as Channel
    const along = (a.from + a.to) / 2
    const middle = (bar.low + bar.high) / 2
    const isAlongX = bar.axis === 'x'
    nodeX[2 * i] = isAlongX ? along : middle
    nodeY[2 * i] = isAlongX ? middle : along
    nodeX[2 * i + 1] = isAlongX ? along : a.mouth
    nodeY[2 * i + 1] = isAlongX ? a.mouth : along
  })
  return { offsets, targets, costs, nodeOrder, nodeEnd, nodeX, nodeY }
}

// The deepest open folder that holds both blocks, as the span of the box tree
// inside it, or the whole tree.
export function scopeOf(nest: ChannelGraph['nest'], from: string, to: string): [number, number] {
  const above = new Set<string>()
  for (let id: string | undefined = from; id !== undefined; id = nest.get(id)?.parent) above.add(id)
  let id = nest.get(to)?.parent
  while (id !== undefined && !above.has(id)) id = nest.get(id)?.parent
  for (let up = id; up !== undefined; up = nest.get(up)?.parent) {
    const entry = nest.get(up)
    if (entry?.isScope) return [entry.order, entry.end]
  }
  return [0, Number.MAX_SAFE_INTEGER]
}

// Shortest paths, one A* search per link, guided by the distance left to the
// imported block, which no path can beat. Each path lists the attachments it
// crosses, from a side of `from` to a side of `to`, through channels inside
// the deepest open folder that holds both, leaving only boxes that hold
// `from`. A link with no such path stays unrouted.
export function findPaths(
  graph: ChannelGraph,
  search: SearchGraph,
  links: readonly Link[],
): (number[] | undefined)[] {
  const { attachments, blockAttachments } = graph
  const { offsets, targets, costs, nodeOrder, nodeEnd, nodeX, nodeY } = search
  const nodes = offsets.length - 1
  const dist = new Float64Array(nodes)
  const prev = new Int32Array(nodes)
  const seen = new Int32Array(nodes)
  const heap = new CostHeap()
  let round = 0
  const run = (link: Link): number[] | undefined => {
    const { from: source, to: target } = link
    const starts = blockAttachments.get(source)
    const ends = blockAttachments.get(target)
    if (!starts || starts.length === 0 || !ends || ends.length === 0 || target === source) {
      return undefined
    }
    const [low, high] = scopeOf(graph.nest, source, target)
    const at = graph.nest.get(source)?.order ?? -1
    // The box around the target's ends.
    let x0 = Number.POSITIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (const a of ends) {
      const x = nodeX[2 * a + 1] as number
      const y = nodeY[2 * a + 1] as number
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    const left = (node: number) => {
      const x = nodeX[node] as number
      const y = nodeY[node] as number
      return Math.max(x0 - x, 0, x - x1) + Math.max(y0 - y, 0, y - y1)
    }
    round++
    heap.clear()
    for (const a of starts) {
      const node = 2 * a + 1
      seen[node] = round
      dist[node] = 0
      prev[node] = -1
      heap.push(node, left(node))
    }
    for (;;) {
      const node = heap.pop()
      if (node < 0) return undefined
      // A node pushed again at a lower cost leaves a stale entry behind.
      if (heap.cost > (dist[node] as number) + left(node)) continue
      if (node % 2 === 1) {
        const block = (attachments[node >> 1] as Attachment).block
        if (block !== undefined && block !== source) {
          if (block === target) {
            // The attachments crossed, read back along the node chain.
            const path: number[] = []
            for (let n = node; prev[n] !== -1; n = prev[n] as number) {
              if ((prev[n] as number) >> 1 === n >> 1) path.push(n >> 1)
            }
            return path.reverse()
          }
          // Block sides are ends, never ways through.
          continue
        }
      }
      const base = dist[node] as number
      for (let e = offsets[node] as number; e < (offsets[node + 1] as number); e++) {
        const next = targets[e] as number
        const order = nodeOrder[next] as number
        if (order >= 0) {
          if (order < low || order >= high) continue
          // Out of a box that does not hold the importer.
          const from = nodeOrder[node] as number
          const end = nodeEnd[node] as number
          if (from >= 0 && (order < from || order >= end) && (at < from || at >= end)) continue
        }
        const cost = base + (costs[e] as number)
        if (seen[next] === round && cost >= (dist[next] as number)) continue
        seen[next] = round
        dist[next] = cost
        prev[next] = node
        heap.push(next, cost + left(next))
      }
    }
  }
  return links.map(run)
}

// A binary min-heap of nodes keyed by path cost. pop() returns the cheapest
// node, or -1, and leaves its cost in `cost`.
export class CostHeap {
  private nodes = new Int32Array(1024)
  private costs = new Float64Array(1024)
  private size = 0
  cost = 0

  clear(): void {
    this.size = 0
  }

  push(node: number, cost: number): void {
    if (this.size === this.nodes.length) {
      const nodes = new Int32Array(this.size * 2)
      nodes.set(this.nodes)
      this.nodes = nodes
      const costs = new Float64Array(this.size * 2)
      costs.set(this.costs)
      this.costs = costs
    }
    const { nodes, costs } = this
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((costs[parent] as number) <= cost) break
      nodes[i] = nodes[parent] as number
      costs[i] = costs[parent] as number
      i = parent
    }
    nodes[i] = node
    costs[i] = cost
  }

  pop(): number {
    if (this.size === 0) return -1
    const { nodes, costs } = this
    const top = nodes[0] as number
    this.cost = costs[0] as number
    const size = --this.size
    const node = nodes[size] as number
    const cost = costs[size] as number
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      if (left >= size) break
      const right = left + 1
      const child =
        right < size && (costs[right] as number) < (costs[left] as number) ? right : left
      if ((costs[child] as number) >= cost) break
      nodes[i] = nodes[child] as number
      costs[i] = costs[child] as number
      i = child
    }
    nodes[i] = node
    costs[i] = cost
    return top
  }
}
