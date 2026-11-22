import {
  type Attachment,
  type Axis,
  type Channel,
  type ChannelGraph,
  laneCapacity,
} from './channel-graph.ts'

// Routes links between blocks through a channel graph (channel-graph.ts) and
// gives each link a lane in every channel it passes, on whole grid units one
// apart, so lines never overlap and stay evenly spaced.
//
// 1. Each link takes the shortest orthogonal path through the channels: along
//    a channel, then across into the next one at a side, with a small cost per
//    bend. It stays inside the deepest open folder that holds both its ends,
//    and leaves only the boxes that hold its importer: it never passes through
//    a folder on its way to another.
// 2. Channels are settled deepest first, so a channel's stems (the channels
//    whose ends meet its sides, and the block sides beside it) already have
//    their positions. Lanes are ordered by where each link enters and leaves,
//    so bundles keep their order through bends, and a stem from the low side
//    always reaches its lane before a stem from the high side at the same spot
//    crosses it. Lines only ever cross at right angles.
// 3. Ports on a block side are ordered the same way, and kept off the spots
//    where a stem arrives from across the channel.
//
// When a channel or block side has fewer whole-unit lanes than links, links
// that import the same block can share a lane (merge); links to different
// blocks never do, so lines in opposite directions never merge. Lanes that
// still do not fit are spread evenly across the channel, apart but closer than
// a unit.

export interface Link {
  from: string
  to: string
}

export interface LaneRouting {
  // Per link: the corner points x0, y0, x1, y1, ... from the importer's side
  // to the imported block's side, or undefined when no path exists.
  points: (Float64Array | undefined)[]
  // Per channel: how many links pass it, and how many lanes they take.
  load: Int32Array
  lanes: Int32Array
  // Links that shared a lane with another, summed over channels.
  merged: number
  // Channels and block sides whose lanes did not fit on whole units.
  crowded: number
}

export interface RouteLanesOptions {
  // Whether links to the same block share a lane: never, or when a channel or
  // block side has too few lanes.
  merge?: 'never' | 'whenFull'
}

// Path cost of one bend, in grid units.
const BEND_COST = 2

// Where a link enters or leaves a channel.
interface Endpoint {
  // -1 a stem on the low side, 1 on the high side, 0 the channel's own end.
  side: number
  // Position along the channel.
  pos: number
}

// A link passing a channel: the channel lies between path[step] and
// path[step + 1], and its lane is line step + 1 of the link.
interface Pass {
  link: number
  step: number
}

// How many links pass each channel, for sizing gutters.
export function countChannelLoad(graph: ChannelGraph, links: readonly Link[]): Int32Array {
  const load = new Int32Array(graph.channels.length)
  for (const path of findPaths(graph, resolveSearchGraph(graph), links)) {
    if (!path) continue
    for (let step = 0; step + 1 < path.length; step++) {
      const c = channelBetween(graph.attachments, path[step] as number, path[step + 1] as number)
      load[c] = (load[c] as number) + 1
    }
  }
  return load
}

export function routeLanes(
  graph: ChannelGraph,
  links: readonly Link[],
  { merge = 'never' }: RouteLanesOptions = {},
): LaneRouting {
  const { channels, attachments } = graph
  // Per link: the attachments it crosses, first and last on block sides.
  const paths = findPaths(graph, resolveSearchGraph(graph), links)
  // Per link, a coordinate per line: the first port, the lane in each
  // channel it passes, the last port.
  const coords = paths.map((path) => (path ? new Float64Array(path.length + 1) : undefined))
  const passes: Pass[][] = channels.map(() => [])
  paths.forEach((path, link) => {
    if (!path) return
    for (let step = 0; step + 1 < path.length; step++) {
      const c = channelBetween(attachments, path[step] as number, path[step + 1] as number)
      passes[c]?.push({ link, step })
    }
  })
  const pathOf = (pass: Pass) => paths[pass.link] as number[]
  const coordsOf = (pass: Pass) => coords[pass.link] as Float64Array

  // The lane (unit) of each of a set of links: links to one block share one
  // when there is not room for all.
  const share = (list: readonly number[], room: number): { unit: number[]; count: number } => {
    if (merge === 'never' || list.length <= room) {
      return { unit: list.map((_, i) => i), count: list.length }
    }
    const ids = new Map<string, number>()
    const unit = list.map((link) => {
      const target = (links[link] as Link).to
      let id = ids.get(target)
      if (id === undefined) {
        id = ids.size
        ids.set(target, id)
      }
      return id
    })
    return { unit, count: ids.size }
  }

  const load = new Int32Array(channels.length)
  const lanes = new Int32Array(channels.length)
  let merged = 0
  let crowded = 0
  const order = channels.map((_, i) => i)
  order.sort((a, b) => (channels[b] as Channel).depth - (channels[a] as Channel).depth)
  for (const c of order) {
    const channel = channels[c] as Channel
    const here = passes[c] as Pass[]
    load[c] = here.length
    if (here.length === 0) continue
    // Where a pass enters (0) or leaves (1): at one of the channel's ends, or
    // from a stem on its side, whose position is the link's line before or
    // after this one.
    const endpoint = (pass: Pass, which: 0 | 1): Endpoint => {
      const a = attachments[pathOf(pass)[pass.step + which] as number] as Attachment
      if (a.bar !== c) return { side: 0, pos: a.end === 0 ? channel.start : channel.end }
      return { side: a.isHigh ? 1 : -1, pos: coordsOf(pass)[pass.step + 2 * which] as number }
    }

    // Block sides along this channel, with the passes that start or end on
    // them. A port is the first or the last line of its link.
    const sides = new Map<number, { pass: Pass; which: 0 | 1 }[]>()
    // Spots where a channel stem already arrives, by side.
    const taken: [Set<number>, Set<number>] = [new Set(), new Set()]
    for (const pass of here) {
      for (const which of [0, 1] as const) {
        const index = pathOf(pass)[pass.step + which] as number
        const a = attachments[index] as Attachment
        if (a.bar !== c) continue
        if (a.block === undefined) {
          taken[a.isHigh ? 1 : 0].add(endpoint(pass, which).pos)
          continue
        }
        const list = sides.get(index)
        if (list) list.push({ pass, which })
        else sides.set(index, [{ pass, which }])
      }
    }
    for (const [index, list] of sides) {
      const a = attachments[index] as Attachment
      // Ordered by where each link heads along the channel.
      const toward = (pass: Pass, which: 0 | 1) => {
        const other = attachments[pathOf(pass)[pass.step + 1 - which] as number] as Attachment
        return other.block === undefined || other.bar !== c
          ? endpoint(pass, which === 0 ? 1 : 0).pos
          : (other.from + other.to) / 2
      }
      const heading = list.map(({ pass, which }) => toward(pass, which))
      const byHeading = list.map((_, i) => i)
      byHeading.sort((i, j) => (heading[i] as number) - (heading[j] as number) || i - j)
      const sorted = byHeading.map((i) => list[i] as { pass: Pass; which: 0 | 1 })
      const { unit, count } = share(
        sorted.map(({ pass }) => pass.link),
        countUnits(a.from, a.to),
      )
      const rank = rankUnits(unit)
      const opposite = taken[a.isHigh ? 0 : 1]
      const ports = placePorts(a.from, a.to, count, opposite)
      if (ports.isCrowded) crowded++
      const own = taken[a.isHigh ? 1 : 0]
      sorted.forEach(({ pass, which }, i) => {
        const value = ports.values[rank[unit[i] as number] as number] as number
        coordsOf(pass)[which === 0 ? 0 : pathOf(pass).length] = value
        own.add(value)
      })
    }

    // Then the lanes, low side first.
    const { unit, count } = share(
      here.map((pass) => pass.link),
      laneCapacity(channel),
    )
    lanes[c] = count
    merged += here.length - count
    const ordered = orderLanes(
      here.map((pass) => [endpoint(pass, 0), endpoint(pass, 1)] as const),
      unit,
      count,
    )
    const values = new Float64Array(count)
    const spread = spreadUnits(channel.low, channel.high, count)
    if (spread.isCrowded) crowded++
    ordered.forEach((u, rank) => {
      values[u] = spread.values[rank] as number
    })
    here.forEach((pass, i) => {
      coordsOf(pass)[pass.step + 1] = values[unit[i] as number] as number
    })
  }

  const points = paths.map((path, link) =>
    path ? buildPoints(graph, path, coords[link] as Float64Array) : undefined,
  )
  return { points, load, lanes, merged, crowded }
}

// Whole units strictly between low and high.
function countUnits(low: number, high: number): number {
  return Math.max(0, Math.ceil(high) - Math.floor(low) - 1)
}

// Units in order of first appearance: unit id -> rank.
function rankUnits(unit: readonly number[]): number[] {
  const rank: number[] = []
  let next = 0
  for (const u of unit) if (rank[u] === undefined) rank[u] = next++
  return rank
}

interface Spread {
  values: Float64Array
  isCrowded: boolean
}

// count values on consecutive whole units strictly between low and high,
// centred, or evenly spread across when they do not fit.
function spreadUnits(low: number, high: number, count: number): Spread {
  const values = new Float64Array(count)
  const room = countUnits(low, high)
  if (count > room) {
    for (let i = 0; i < count; i++) values[i] = low + ((high - low) * (i + 1)) / (count + 1)
    return { values, isCrowded: true }
  }
  const first = Math.floor(low) + 1 + Math.floor((room - count) / 2)
  for (let i = 0; i < count; i++) values[i] = first + i
  return { values, isCrowded: false }
}

// Like spreadUnits, but slides the run of ports along the side to land on
// as few spots taken across the channel as it can, nearest the centre first.
function placePorts(low: number, high: number, count: number, taken: ReadonlySet<number>): Spread {
  const centred = spreadUnits(low, high, count)
  if (centred.isCrowded || count === 0 || taken.size === 0) return centred
  const first = Math.floor(low) + 1
  const slack = countUnits(low, high) - count
  const middle = Math.floor(slack / 2)
  let best = middle
  let bestHits = Number.POSITIVE_INFINITY
  for (let d = 0; d <= slack; d++) {
    for (const offset of d === 0 ? [middle] : [middle - d, middle + d]) {
      if (offset < 0 || offset > slack) continue
      let hits = 0
      for (let i = 0; i < count; i++) if (taken.has(first + offset + i)) hits++
      if (hits < bestHits) {
        best = offset
        bestHits = hits
      }
    }
    if (bestHits === 0) break
  }
  const values = new Float64Array(count)
  for (let i = 0; i < count; i++) values[i] = first + best + i
  return { values, isCrowded: false }
}

// The order of lanes across a channel, low side first, as unit ids. Passes
// that turn back to the low side sit nearest it, nested by span; passes that
// leave by an end sit nearer the side they came from the closer they are to
// that end; passes that cross over sit in the middle. A stem from the low side
// must reach its lane before a stem from the high side at the same spot, or
// the two would overlap. Passes that share a lane are ordered as one, by their
// average.
function orderLanes(
  ends: readonly (readonly [Endpoint, Endpoint])[],
  unitOf: readonly number[],
  count: number,
): number[] {
  const key = new Float64Array(count)
  const tie = new Float64Array(count)
  const size = new Float64Array(count)
  ends.forEach(([a, b], p) => {
    const sides = a.side + b.side
    const span = Math.abs(a.pos - b.pos)
    let passKey = 0
    let passTie = 0
    if (sides < 0) {
      passKey = sides
      passTie = span
    } else if (sides > 0) {
      passKey = sides
      passTie = -span
    } else if (a.side !== 0) {
      // Crosses from one side to the other.
      const low = a.side < 0 ? a.pos : b.pos
      const high = a.side < 0 ? b.pos : a.pos
      passKey = low < high ? -0.5 : 0.5
      passTie = low < high ? -(low + high) : low + high
    }
    const u = unitOf[p] as number
    key[u] = (key[u] as number) + passKey
    tie[u] = (tie[u] as number) + passTie
    size[u] = (size[u] as number) + 1
  })
  for (let u = 0; u < count; u++) {
    key[u] = (key[u] as number) / (size[u] as number)
    tie[u] = (tie[u] as number) / (size[u] as number)
  }
  const before = (i: number, j: number) =>
    (key[i] as number) - (key[j] as number) || (tie[i] as number) - (tie[j] as number) || i - j

  // Stems at the same spot from both sides: the low one's lane comes first.
  const lowAt = new Map<number, number[]>()
  ends.forEach((pair, p) => {
    for (const end of pair) {
      if (end.side !== -1) continue
      const list = lowAt.get(end.pos)
      if (list) list.push(unitOf[p] as number)
      else lowAt.set(end.pos, [unitOf[p] as number])
    }
  })
  const after: number[][] = Array.from({ length: count }, () => [])
  const waiting = new Int32Array(count)
  ends.forEach((pair, p) => {
    const u = unitOf[p] as number
    for (const end of pair) {
      if (end.side !== 1) continue
      for (const v of lowAt.get(end.pos) ?? []) {
        if (v === u) continue
        after[v]?.push(u)
        waiting[u] = (waiting[u] as number) + 1
      }
    }
  })

  const ready = new OrderHeap(before)
  for (let u = 0; u < count; u++) if (waiting[u] === 0) ready.push(u)
  const all = Array.from({ length: count }, (_, u) => u).sort(before)
  const placed = new Uint8Array(count)
  const result: number[] = []
  let next = 0
  while (result.length < count) {
    let u = ready.pop()
    if (u < 0) {
      // A cycle: take the first unit left and break it.
      while (placed[all[next] as number]) next++
      u = all[next] as number
    }
    if (placed[u]) continue
    placed[u] = 1
    result.push(u)
    for (const v of after[u] as number[]) {
      waiting[v] = (waiting[v] as number) - 1
      if (waiting[v] === 0 && !placed[v]) ready.push(v)
    }
  }
  return result
}

// The channel a link runs in between two consecutive attachments: the one
// both touch, as bar or as stem.
function channelBetween(attachments: readonly Attachment[], a: number, b: number): number {
  const first = attachments[a] as Attachment
  const second = attachments[b] as Attachment
  if (first.bar === second.bar || first.bar === second.channel) return first.bar
  return first.channel as number
}

// The corners of a link: from its first port, across each channel's lane, to
// its last port. Consecutive lines are always at right angles.
function buildPoints(graph: ChannelGraph, path: number[], coords: Float64Array): Float64Array {
  const { attachments, channels } = graph
  const lines = path.length + 1
  // Per line, the axis it runs along.
  const axes: Axis[] = []
  for (let line = 0; line < lines; line++) {
    if (line === 0 || line === lines - 1) {
      const a = attachments[path[line === 0 ? 0 : path.length - 1] as number] as Attachment
      axes.push((channels[a.bar] as Channel).axis === 'x' ? 'y' : 'x')
    } else {
      const c = channelBetween(attachments, path[line - 1] as number, path[line] as number)
      axes.push((channels[c] as Channel).axis)
    }
  }
  const points = new Float64Array(2 * (lines + 1))
  // A point on a line running along `axis` at `across`, at `along`.
  const put = (k: number, axis: Axis, across: number, along: number) => {
    points[2 * k] = axis === 'x' ? along : across
    points[2 * k + 1] = axis === 'x' ? across : along
  }
  const first = attachments[path[0] as number] as Attachment
  const last = attachments[path[path.length - 1] as number] as Attachment
  put(0, axes[0] as Axis, coords[0] as number, first.mouth)
  for (let line = 0; line + 1 < lines; line++) {
    put(line + 1, axes[line] as Axis, coords[line] as number, coords[line + 1] as number)
  }
  put(lines, axes[lines - 1] as Axis, coords[lines - 1] as number, last.mouth)
  return points
}

// Nodes: two per attachment, one on its bar (2a) and one on its stem (2a + 1),
// a channel end or a block side. Edges run along each channel between the
// nodes on it, and across each attachment.
interface SearchGraph {
  // Compressed adjacency.
  offsets: Int32Array
  targets: Int32Array
  costs: Float64Array
  // Per node, the span in the box tree (see BoxNest) of the container its
  // channel was cut in, or -1 for a block side.
  nodeOrder: Int32Array
  nodeEnd: Int32Array
}

// Each channel graph's search graph, built on first use: a level routes the
// same graph again for every new focus.
const searchGraphs = new WeakMap<ChannelGraph, SearchGraph>()

function resolveSearchGraph(graph: ChannelGraph): SearchGraph {
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
  attachments.forEach((a, i) => {
    put(2 * i, a.bar)
    put(2 * i + 1, a.channel)
  })
  return { offsets, targets, costs, nodeOrder, nodeEnd }
}

// The deepest open folder that holds both blocks, as the span of the box tree
// inside it, or the whole tree.
function scopeOf(nest: ChannelGraph['nest'], from: string, to: string): [number, number] {
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

// Shortest paths, one search per importing block and scope. Each path lists
// the attachments it crosses, from a side of `from` to a side of `to`, through
// channels inside the deepest open folder that holds both, leaving only boxes
// that hold `from`. A link with no such path stays unrouted.
function findPaths(
  graph: ChannelGraph,
  search: SearchGraph,
  links: readonly Link[],
): (number[] | undefined)[] {
  const { attachments, blockAttachments } = graph
  const { offsets, targets, costs, nodeOrder, nodeEnd } = search
  const nodes = offsets.length - 1
  const dist = new Float64Array(nodes)
  const prev = new Int32Array(nodes)
  const seen = new Int32Array(nodes)
  const heap = new CostHeap()
  let round = 0
  const paths: (number[] | undefined)[] = links.map(() => undefined)
  const searches = new Map<string, { source: string; scope: [number, number]; list: number[] }>()
  links.forEach((link, i) => {
    const scope = scopeOf(graph.nest, link.from, link.to)
    const key = `${link.from}\n${scope[0]}`
    const found = searches.get(key)
    if (found) found.list.push(i)
    else searches.set(key, { source: link.from, scope, list: [i] })
  })
  const run = (source: string, [low, high]: [number, number], list: readonly number[]) => {
    const starts = blockAttachments.get(source)
    if (!starts || starts.length === 0) return
    const at = graph.nest.get(source)?.order ?? -1
    // Links still looking for a path, by target.
    const wanted = new Map<string, number[]>()
    for (const i of list) {
      const target = (links[i] as Link).to
      if (target === source) continue
      const ids = wanted.get(target)
      if (ids) ids.push(i)
      else wanted.set(target, [i])
    }
    round++
    heap.clear()
    for (const a of starts) {
      const node = 2 * a + 1
      seen[node] = round
      dist[node] = 0
      prev[node] = -1
      heap.push(node, 0)
    }
    while (wanted.size > 0) {
      const node = heap.pop()
      if (node < 0) break
      // A node pushed again at a lower cost leaves a stale entry behind.
      if (heap.cost > (dist[node] as number)) continue
      if (node % 2 === 1) {
        const block = (attachments[node >> 1] as Attachment).block
        if (block !== undefined && block !== source) {
          const found = wanted.get(block)
          if (found) {
            wanted.delete(block)
            // The attachments crossed, read back along the node chain.
            const path: number[] = []
            for (let n = node; prev[n] !== -1; n = prev[n] as number) {
              if ((prev[n] as number) >> 1 === n >> 1) path.push(n >> 1)
            }
            path.reverse()
            for (const i of found) paths[i] = path
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
        heap.push(next, cost)
      }
    }
  }
  for (const { source, scope, list } of searches.values()) run(source, scope, list)
  return paths
}

// A binary min-heap of nodes keyed by path cost. pop() returns the cheapest
// node, or -1, and leaves its cost in `cost`.
class CostHeap {
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

// A binary min-heap of indices under a fixed order. pop() returns -1 when
// empty.
class OrderHeap {
  private readonly items: number[] = []
  private readonly before: (a: number, b: number) => number

  constructor(before: (a: number, b: number) => number) {
    this.before = before
  }

  push(value: number): void {
    const items = this.items
    let i = items.push(value) - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.before(items[parent] as number, value) <= 0) break
      items[i] = items[parent] as number
      i = parent
    }
    items[i] = value
  }

  pop(): number {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (top === undefined || last === undefined) return -1
    if (items.length === 0) return top
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      if (left >= items.length) break
      const right = left + 1
      const child =
        right < items.length && this.before(items[right] as number, items[left] as number) < 0
          ? right
          : left
      if (this.before(items[child] as number, last) >= 0) break
      items[i] = items[child] as number
      i = child
    }
    items[i] = last
    return top
  }
}
