import {
  type Attachment,
  type Axis,
  type Channel,
  type ChannelGraph,
  laneCapacity,
} from './channel-graph.ts'
import { planHighways } from './highways.ts'
import { channelBetween } from './search-graph.ts'

// Routes links between blocks through a channel graph (channel-graph.ts) and
// gives each link a lane in every channel it passes, on whole grid units one
// apart, so lines never overlap and stay evenly spaced.
//
// 1. Each link's path is planned as a chain of shared stretches between
//    folders' entry points (highways.ts): shortest orthogonal paths through
//    the channels, with a small cost per bend, inside the deepest open folder
//    that holds both its ends, never through a folder on the way to another.
//    Links on the same stretch share one lane along it.
// 2. Channels are settled deepest first, so a channel's stems (the channels
//    whose ends meet its sides, and the block sides beside it) already have
//    their positions. Lanes are ordered by where each link enters and leaves,
//    so bundles keep their order through bends, and a stem from the low side
//    always reaches its lane before a stem from the high side at the same spot
//    crosses it. Lines only ever cross at right angles.
// 3. Ports on a block side are ordered the same way, and kept off the spots
//    where a stem arrives from across the channel.
//
// When a channel or block side has fewer whole-unit lanes than stretches,
// stretches that run to the same end (a file, or an entry point from one
// side) can share a lane (merge); stretches never share one with a stretch
// the other way, so lines in opposite directions never merge. Lanes that
// still do not fit are spread evenly across the channel, apart but closer than
// a unit. With a stride, lanes and ports sit that many units apart where they
// fit, and one unit apart where they do not, before any merge.

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
  // Whether stretches to the same end share a lane: never, or when a channel
  // or block side has too few lanes.
  merge?: 'never' | 'whenFull'
  // How many units apart lanes and ports sit where there is room, on the
  // multiples of it: on a routing scaled by a pitch, the pitch keeps lines a
  // whole grid unit apart wherever they fit.
  stride?: number
}

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

// How many lanes each channel needs, one per stretch through it, for sizing
// gutters.
export function countChannelLoad(graph: ChannelGraph, links: readonly Link[]): Int32Array {
  const load = new Int32Array(graph.channels.length)
  const { paths, stretches } = planHighways(graph, links)
  const counted = new Set<number>()
  paths.forEach((path, link) => {
    if (!path) return
    const tags = stretches[link] as Int32Array
    for (let step = 0; step + 1 < path.length; step++) {
      const c = channelBetween(graph.attachments, path[step] as number, path[step + 1] as number)
      const key = c * 0x100000 + (tags[step] as number)
      if (counted.has(key)) continue
      counted.add(key)
      load[c] = (load[c] as number) + 1
    }
  })
  return load
}

export function routeLanes(
  graph: ChannelGraph,
  links: readonly Link[],
  { merge = 'never', stride = 1 }: RouteLanesOptions = {},
): LaneRouting {
  const { channels, attachments } = graph
  // Per link: the attachments it crosses, first and last on block sides, and
  // the stretch of each step.
  const { paths, stretches, stretchEnds } = planHighways(graph, links)
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
  const stretchOf = (pass: Pass) => (stretches[pass.link] as Int32Array)[pass.step] as number

  // The lane (unit) of each of a set of passes: passes on one stretch share
  // one, and stretches to one end share one when there is not room for all.
  const share = (list: readonly Pass[], room: number): { unit: number[]; count: number } => {
    const group = (key: (pass: Pass) => number) => {
      const ids = new Map<number, number>()
      const unit = list.map((pass) => {
        const k = key(pass)
        let id = ids.get(k)
        if (id === undefined) {
          id = ids.size
          ids.set(k, id)
        }
        return id
      })
      return { unit, count: ids.size }
    }
    const own = group(stretchOf)
    if (merge === 'never' || own.count <= room) return own
    return group((pass) => stretchEnds[stretchOf(pass)] as number)
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
        sorted.map(({ pass }) => pass),
        countUnits(a.from, a.to),
      )
      const rank = rankUnits(unit)
      const opposite = taken[a.isHigh ? 0 : 1]
      const ports = placePorts(a.from, a.to, count, opposite, stride)
      if (ports.isCrowded) crowded++
      const own = taken[a.isHigh ? 1 : 0]
      sorted.forEach(({ pass, which }, i) => {
        const value = ports.values[rank[unit[i] as number] as number] as number
        coordsOf(pass)[which === 0 ? 0 : pathOf(pass).length] = value
        own.add(value)
      })
    }

    // Then the lanes, low side first.
    const { unit, count } = share(here, laneCapacity(channel))
    lanes[c] = count
    merged += here.length - count
    const ordered = orderLanes(
      here.map((pass) => [endpoint(pass, 0), endpoint(pass, 1)] as const),
      unit,
      count,
    )
    const values = new Float64Array(count)
    const spread = spreadUnits(channel.low, channel.high, count, stride)
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

// count values on whole units strictly between low and high, centred: on the
// multiples of stride when they fit there, else on consecutive units, else
// evenly spread across.
function spreadUnits(low: number, high: number, count: number, stride = 1): Spread {
  const values = new Float64Array(count)
  const run = findRun(low, high, count, stride)
  if (!run) {
    for (let i = 0; i < count; i++) values[i] = low + ((high - low) * (i + 1)) / (count + 1)
    return { values, isCrowded: true }
  }
  const first = run.first + Math.floor((run.room - count) / 2) * run.step
  for (let i = 0; i < count; i++) values[i] = first + i * run.step
  return { values, isCrowded: false }
}

// The spots for count values strictly between low and high: the multiples of
// stride if there are enough, else every whole unit; undefined when even
// those are too few.
function findRun(
  low: number,
  high: number,
  count: number,
  stride: number,
): { first: number; step: number; room: number } | undefined {
  if (stride > 1) {
    const room = Math.max(0, Math.ceil(high / stride) - Math.floor(low / stride) - 1)
    if (count <= room) return { first: (Math.floor(low / stride) + 1) * stride, step: stride, room }
  }
  const room = countUnits(low, high)
  return count <= room ? { first: Math.floor(low) + 1, step: 1, room } : undefined
}

// Like spreadUnits, but slides the run of ports along the side to land on
// as few spots taken across the channel as it can, nearest the centre first.
function placePorts(
  low: number,
  high: number,
  count: number,
  taken: ReadonlySet<number>,
  stride = 1,
): Spread {
  const centred = spreadUnits(low, high, count, stride)
  const run = findRun(low, high, count, stride)
  if (!run || count === 0 || taken.size === 0) return centred
  const { first, step } = run
  const slack = run.room - count
  const middle = Math.floor(slack / 2)
  let best = middle
  let bestHits = Number.POSITIVE_INFINITY
  for (let d = 0; d <= slack; d++) {
    for (const offset of d === 0 ? [middle] : [middle - d, middle + d]) {
      if (offset < 0 || offset > slack) continue
      let hits = 0
      for (let i = 0; i < count; i++) if (taken.has(first + (offset + i) * step)) hits++
      if (hits < bestHits) {
        best = offset
        bestHits = hits
      }
    }
    if (bestHits === 0) break
  }
  const values = new Float64Array(count)
  for (let i = 0; i < count; i++) values[i] = first + (best + i) * step
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
  return dropStraightCorners(points)
}

// The corners left once corners where a line runs straight on (two lanes
// at one spot, as where lines cross a gutter on one shared lane) are dropped.
function dropStraightCorners(points: Float64Array): Float64Array {
  const kept: number[] = []
  const count = points.length / 2
  for (let k = 0; k < count; k++) {
    const x = points[2 * k] as number
    const y = points[2 * k + 1] as number
    const n = kept.length
    if (n >= 2 && kept[n - 2] === x && kept[n - 1] === y) continue
    if (n >= 4) {
      // The last kept corner lies on a straight run to this point.
      const px = kept[n - 4] as number
      const py = kept[n - 3] as number
      const cx = kept[n - 2] as number
      const cy = kept[n - 1] as number
      if ((px === cx && cx === x) || (py === cy && cy === y)) {
        kept[n - 2] = x
        kept[n - 1] = y
        continue
      }
    }
    kept.push(x, y)
  }
  return kept.length === points.length ? points : Float64Array.from(kept)
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
