import type { Rect } from '../world/world-types.ts'

// The free space between blocks, cut into channels that dependency lanes run
// along. Shared by the layout, which widens gutters to fit the lanes, and the
// page, which draws them.
//
// A container sits its children in rows, a row in slots and a slot in a
// stack, with a gutter between each, so its free space cuts cleanly: across
// the rows, then between the slots of each row, then between the stacked
// boxes, and on into open children. A cut between two groups of boxes is a
// channel, and lanes run along it on the whole grid lines strictly inside it.
// A cut at the edge of a band, such as a container's padding or the room below
// a short block in a tall row, holds no lanes: lines only cross it straight on
// their way between a channel and a block side or another channel.

// The direction lanes run in: 'x' for a horizontal channel.
export type Axis = 'x' | 'y'

export type BlockSide = 'top' | 'right' | 'bottom' | 'left'

export interface RouteBox {
  id: string
  rect: Rect
  // An open container: the height of its label strip, which lines never
  // cross, and the boxes inside it. A box without kids is a block: lines start
  // and end on its sides and never cross it.
  header?: number
  kids?: readonly RouteBox[]
}

export interface Channel {
  axis: Axis
  // Across the lanes: the free strip from low to high. Lanes sit on the
  // whole units strictly between them.
  low: number
  high: number
  // Along the lanes: where the strip starts and ends.
  start: number
  end: number
  // How deep in the cut the channel lies. Its ends run into shallower
  // channels, so deeper channels are always settled first.
  depth: number
  // The container it was cut in and, of that container's boxes, those whose
  // near edge is the channel's high side: widening the channel moves them.
  container: string
  after: string[]
  // The channel each end runs into, start then end, or -1.
  bars: [number, number]
}

// Where a stem meets a channel (its bar) from the side. The stem is a block
// side or a channel end; between the two there is only padding.
export interface Attachment {
  bar: number
  // The stem is on the bar's high side.
  isHigh: boolean
  // The stem's extent along the bar.
  from: number
  to: number
  // Where the stem's mouth is, across the bar: a block side's edge or a
  // channel's end.
  mouth: number
  // A block side, or a channel end (0 at its start, 1 at its end).
  block?: string
  side?: BlockSide
  channel?: number
  end?: 0 | 1
}

export interface ChannelGraph {
  channels: Channel[]
  attachments: Attachment[]
  // Attachment indices of each block.
  blockAttachments: Map<string, number[]>
  // Boxes the cut could not separate; their blocks have no attachments.
  stuck: number
}

interface Band {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Item {
  band: Band
  box: RouteBox | undefined
}

// Channels next to a band, by side: top, right, bottom, left.
type Neighbours = [number, number, number, number]

// Width of the ring of channels around the map, in units.
const RING_UNITS = 8

const TOP = 0
const RIGHT = 1
const BOTTOM = 2
const LEFT = 3
// For a cut across y: the sides its pieces stack from and to, and the sides
// its channels start and end at. Across x, the other way round.
const CUT_SIDES = {
  y: [TOP, BOTTOM, LEFT, RIGHT],
  x: [LEFT, RIGHT, TOP, BOTTOM],
} as const

export function buildChannelGraph(root: RouteBox): ChannelGraph {
  const graph: ChannelGraph = {
    channels: [],
    attachments: [],
    blockAttachments: new Map(),
    stuck: 0,
  }

  const attach = (attachment: Attachment) => {
    const index = graph.attachments.push(attachment) - 1
    if (attachment.block === undefined) return
    const list = graph.blockAttachments.get(attachment.block)
    if (list) list.push(index)
    else graph.blockAttachments.set(attachment.block, [index])
  }

  // A block's sides meet whichever channels lie past the padding beside them.
  const placeBlock = (box: RouteBox, nb: Neighbours) => {
    const b = toBand(box.rect)
    const sides: [BlockSide, number, boolean, number, number, number][] = [
      ['top', nb[TOP], true, b.x0, b.x1, b.y0],
      ['right', nb[RIGHT], false, b.y0, b.y1, b.x1],
      ['bottom', nb[BOTTOM], false, b.x0, b.x1, b.y1],
      ['left', nb[LEFT], true, b.y0, b.y1, b.x0],
    ]
    if (!graph.blockAttachments.has(box.id)) graph.blockAttachments.set(box.id, [])
    for (const [side, bar, isHigh, from, to, mouth] of sides) {
      if (bar >= 0) attach({ bar, isHigh, from, to, mouth, block: box.id, side })
    }
  }

  const placeContainer = (box: RouteBox, nb: Neighbours, depth: number) => {
    const band = toBand(box.rect)
    const items: Item[] = []
    const header = box.header ?? 0
    if (header > 0) {
      items.push({ band: { ...band, y1: Math.min(band.y0 + header, band.y1) }, box: undefined })
    }
    for (const kid of box.kids ?? []) items.push({ band: toBand(kid.rect), box: kid })
    split(band, items, 'y', nb, box.id, depth, false)
  }

  const place = (item: Item, nb: Neighbours, depth: number) => {
    const { box } = item
    if (!box) return
    if (box.kids) placeContainer(box, nb, depth)
    else placeBlock(box, nb)
  }

  // Cuts a band across `across` (y: into horizontal strips) between groups of
  // items that do not overlap on that axis, then each group the other way.
  const split = (
    band: Band,
    items: Item[],
    across: Axis,
    nb: Neighbours,
    container: string,
    depth: number,
    isRetry: boolean,
  ): void => {
    if (items.length === 0) return
    if (items.length === 1) {
      place(items[0] as Item, nb, depth)
      return
    }
    const groups = groupItems(items, across)
    if (groups.length === 1) {
      if (isRetry) {
        // Not a row layout: leave these boxes without lanes.
        graph.stuck += items.length
        return
      }
      split(band, items, across === 'y' ? 'x' : 'y', nb, container, depth, true)
      return
    }
    const [lowSide, highSide, startSide, endSide] = CUT_SIDES[across]
    const [start, end] = across === 'y' ? [band.x0, band.x1] : [band.y0, band.y1]
    // The channel after each group, or -1 when the next group touches it.
    const between: number[] = []
    for (let g = 0; g + 1 < groups.length; g++) {
      const low = (groups[g] as Group).end
      const next = groups[g + 1] as Group
      if (next.start <= low) {
        between.push(-1)
        continue
      }
      const after: string[] = []
      for (const item of next.items) {
        if (item.box && lowEdge(item.band, across) === next.start) after.push(item.box.id)
      }
      const index =
        graph.channels.push({
          axis: across === 'y' ? 'x' : 'y',
          low,
          high: next.start,
          start,
          end,
          depth,
          container,
          after,
          bars: [nb[startSide], nb[endSide]],
        }) - 1
      between.push(index)
      // Its ends meet the channels beside the band, from their high and low
      // sides.
      if (nb[startSide] >= 0) {
        attach({
          bar: nb[startSide],
          isHigh: true,
          from: low,
          to: next.start,
          mouth: start,
          channel: index,
          end: 0,
        })
      }
      if (nb[endSide] >= 0) {
        attach({
          bar: nb[endSide],
          isHigh: false,
          from: low,
          to: next.start,
          mouth: end,
          channel: index,
          end: 1,
        })
      }
    }
    groups.forEach((group, g) => {
      const piece: Band =
        across === 'y'
          ? { ...band, y0: group.start, y1: group.end }
          : { ...band, x0: group.start, x1: group.end }
      const pieceNb: Neighbours = [...nb]
      pieceNb[lowSide] = g === 0 ? nb[lowSide] : (between[g - 1] as number)
      pieceNb[highSide] = g === groups.length - 1 ? nb[highSide] : (between[g] as number)
      split(piece, group.items, across === 'y' ? 'x' : 'y', pieceNb, container, depth + 1, false)
    })
  }

  // A ring of channels around the whole map, so that a row with one wide
  // block in it never cuts the map in two: lines can always go round.
  const band = toBand(root.rect)
  const ring = (channel: Omit<Channel, 'container' | 'after'>) =>
    graph.channels.push({ ...channel, container: root.id, after: [] }) - 1
  const left = ring({
    axis: 'y',
    low: band.x0 - RING_UNITS,
    high: band.x0,
    start: band.y0 - RING_UNITS,
    end: band.y1 + RING_UNITS,
    depth: -2,
    bars: [-1, -1],
  })
  const right = ring({
    axis: 'y',
    low: band.x1,
    high: band.x1 + RING_UNITS,
    start: band.y0 - RING_UNITS,
    end: band.y1 + RING_UNITS,
    depth: -2,
    bars: [-1, -1],
  })
  for (const [low, high] of [
    [band.y0 - RING_UNITS, band.y0],
    [band.y1, band.y1 + RING_UNITS],
  ] as const) {
    const index = ring({
      axis: 'x',
      low,
      high,
      start: band.x0,
      end: band.x1,
      depth: -1,
      bars: [left, right],
    })
    attach({ bar: left, isHigh: true, from: low, to: high, mouth: band.x0, channel: index, end: 0 })
    attach({
      bar: right,
      isHigh: false,
      from: low,
      to: high,
      mouth: band.x1,
      channel: index,
      end: 1,
    })
  }
  const top = graph.channels.length - 2
  const bottom = graph.channels.length - 1
  place({ band, box: root }, [top, right, bottom, left], 0)
  return graph
}

interface Group {
  start: number
  end: number
  items: Item[]
}

// Items in runs that overlap on one axis; touching runs stay apart.
function groupItems(items: Item[], across: Axis): Group[] {
  const sorted = [...items].sort((a, b) => lowEdge(a.band, across) - lowEdge(b.band, across))
  const groups: Group[] = []
  for (const item of sorted) {
    const lo = lowEdge(item.band, across)
    const hi = highEdge(item.band, across)
    const last = groups[groups.length - 1]
    if (last && lo < last.end) {
      last.end = Math.max(last.end, hi)
      last.items.push(item)
    } else {
      groups.push({ start: lo, end: hi, items: [item] })
    }
  }
  return groups
}

function toBand(rect: Rect): Band {
  return { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h }
}

function lowEdge(band: Band, across: Axis): number {
  return across === 'y' ? band.y0 : band.x0
}

function highEdge(band: Band, across: Axis): number {
  return across === 'y' ? band.y1 : band.x1
}

// Whole-unit lanes a channel holds: the grid lines strictly inside it.
export function laneCapacity(channel: Channel): number {
  return Math.max(0, Math.ceil(channel.high) - Math.floor(channel.low) - 1)
}
