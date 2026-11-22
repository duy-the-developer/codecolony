import { type BlockSide, buildChannelGraph, laneCapacity } from '../lane-routing/channel-graph.ts'
import { buildRouteBoxes } from '../lane-routing/route-boxes.ts'
import { countChannelLoad, type Link } from '../lane-routing/route-lanes.ts'
import type { Edge, WorldNode } from '../world/world-types.ts'
import type { GapWidening, StoredRow } from './pack-rows.ts'

// Gutters grow so the Dependency overlay's lanes fit them one unit apart, up
// to a cap; past it the page merges lanes to one block and packs the rest
// closer. A folder's ring grows the same way on each side, up to RING_LANES.
// Links are routed between the blocks seen with every folder open and every
// module of files closed, which need the most lanes between modules.

// Container id -> extra units per gap of its rows, and per side of its ring.
export type LaneWidening = Map<string, MutableGapWidening>

export interface MutableGapWidening extends GapWidening {
  rows: Map<string, number>
  slots: Map<string, number>
  stacks: Map<string, number>
  ring: Record<BlockSide, number>
}

// The most lanes a folder's ring grows to hold on each side.
export const RING_LANES = 1

function emptyWidening(): MutableGapWidening {
  return {
    rows: new Map(),
    slots: new Map(),
    stacks: new Map(),
    ring: { top: 0, right: 0, bottom: 0, left: 0 },
  }
}

interface Spot {
  row: string
  slot: string
  isStacked: boolean
}

// The edge kinds the Dependency overlay draws.
export const LANE_EDGE_KINDS: ReadonlySet<Edge['kind']> = new Set(['import'])

// The links between blocks at full zoom, one per importing and imported block.
export function listBlockLinks(
  edges: readonly Edge[],
  blockOf: (id: string) => string | undefined,
): Link[] {
  const seen = new Set<string>()
  const links: Link[] = []
  for (const edge of edges) {
    if (!LANE_EDGE_KINDS.has(edge.kind)) continue
    const from = blockOf(edge.from)
    const to = blockOf(edge.to)
    if (!from || !to || from === to) continue
    const key = `${from}\n${to}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ from, to })
  }
  return links
}

// Adds to `widening` the units each gutter and ring side is short of holding
// its lanes, gutters up to maxGutter units wide. rows: each container's rows
// as laid out. True when anything grew.
export function resolveLaneWidening(
  nodes: readonly WorldNode[],
  edges: readonly Edge[],
  rows: ReadonlyMap<string, readonly StoredRow[]>,
  maxGutter: number,
  widening: LaneWidening,
): boolean {
  const boxes = buildRouteBoxes(nodes)
  if (!boxes.root) return false
  const graph = buildChannelGraph(boxes.root)
  const load = countChannelLoad(graph, listBlockLinks(edges, boxes.blockOf))
  // Where each item sits in its container's rows: the first item of its row,
  // the first item of its slot, and whether it is first in its stack. Gaps
  // before a row or slot are keyed by its first item, so rounds add up.
  const spots = new Map<string, Map<string, Spot>>()
  const spotOf = (container: string, id: string) => {
    let byId = spots.get(container)
    if (!byId) {
      const found = new Map<string, Spot>()
      for (const row of rows.get(container) ?? []) {
        const rowFirst = row.slots[0]?.[0]
        for (const slot of row.slots) {
          slot.forEach((item, k) => {
            if (rowFirst && slot[0]) {
              found.set(item, { row: rowFirst, slot: slot[0], isStacked: k > 0 })
            }
          })
        }
      }
      byId = found
      spots.set(container, byId)
    }
    return byId.get(id)
  }
  // The most each gap is short by this round.
  const short = new Map<string, MutableGapWidening>()
  graph.channels.forEach((channel, c) => {
    const want = Math.min(load[c] as number, channel.ring ? RING_LANES : maxGutter - 1)
    const missing = want - laneCapacity(channel)
    if (missing <= 0) return
    let gaps = short.get(channel.container)
    if (!gaps) {
      gaps = emptyWidening()
      short.set(channel.container, gaps)
    }
    if (channel.ring) {
      gaps.ring[channel.ring] = Math.max(gaps.ring[channel.ring], missing)
      return
    }
    for (const id of channel.after) {
      const spot = spotOf(channel.container, id)
      if (!spot) continue
      // A horizontal channel lies above a row, or above an item in a stack;
      // a vertical one lies left of a slot.
      const [map, key] =
        channel.axis === 'y'
          ? [gaps.slots, spot.slot]
          : spot.isStacked
            ? [gaps.stacks, id]
            : [gaps.rows, spot.row]
      map.set(key, Math.max(map.get(key) ?? 0, missing))
    }
  })
  let grew = false
  for (const [container, gaps] of short) {
    let total = widening.get(container)
    if (!total) {
      total = emptyWidening()
      widening.set(container, total)
    }
    for (const key of ['rows', 'slots', 'stacks'] as const) {
      for (const [id, units] of gaps[key]) {
        total[key].set(id, (total[key].get(id) ?? 0) + units)
        grew = true
      }
    }
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (gaps.ring[side] === 0) continue
      total.ring[side] += gaps.ring[side]
      grew = true
    }
  }
  return grew
}
