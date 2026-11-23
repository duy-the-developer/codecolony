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
// A cut at the edge of a band, such as the room below a short block in a tall
// row, holds no lanes: lines only cross it straight on their way between a
// channel and a block side or another channel. With edgeLanes, such room that
// holds a lane is a channel too, so that a block side facing it meets the
// lane beside it rather than one further out.
//
// An open folder's padding is a ring of four channels inside its border, below
// its label strip, so that links between two of its boxes can always go round
// inside it. A line leaves a folder only straight on, through a door: where a
// gutter inside it, or its ring's top or bottom channel, ends on the ring's
// left, right or bottom channel, the line may carry on across the ring and
// the border into the channel outside. The ring's sides also open out at the
// bottom. The label strip's text is never crossed: where the strip has room
// right of its label, a door runs straight down through it into the ring's
// top channel.

// The direction lanes run in: 'x' for a horizontal channel.
export type Axis = 'x' | 'y'

export type BlockSide = 'top' | 'right' | 'bottom' | 'left'

export interface RouteBox {
  id: string
  rect: Rect
  // An open container: the height of its label strip, whose label lines
  // never cross, and the boxes inside it. A box without kids is a block: lines
  // start and end on its sides and never cross it.
  header?: number
  // How far the label text reaches into the strip from the box's left edge;
  // without it the whole strip is the label's.
  label?: number
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
  // The channel each end runs into, start then end, or -1. A door is another
  // way out of an end (see the attachments).
  bars: [number, number]
  // A channel of its container's ring: the side of the folder it lines.
  ring?: BlockSide
}

// A box's place in the box tree: a box lies inside another when its order
// falls in [order, end) of the other.
export interface BoxNest {
  parent: string | undefined
  order: number
  end: number
  // An open folder (or the root): links whose ends it holds stay inside it.
  isScope: boolean
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
  // Every box by id.
  nest: Map<string, BoxNest>
  // The ring of channels around the whole map, by side.
  around: Record<BlockSide, number>
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

// Width of the ring of channels around the map, in units, by default.
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

export function buildChannelGraph(
  root: RouteBox,
  edgeLanes = false,
  ringUnits = RING_UNITS,
): ChannelGraph {
  const graph: ChannelGraph = {
    channels: [],
    attachments: [],
    blockAttachments: new Map(),
    stuck: 0,
    nest: nestBoxes(root),
    around: { top: -1, right: -1, bottom: -1, left: -1 },
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
    const items: Item[] = []
    for (const kid of box.kids ?? []) items.push({ band: toBand(kid.rect), box: kid })
    if ((box.header ?? 0) > 0) placeFolder(box, items, nb, depth)
    else split(toBand(box.rect), items, 'y', nb, box.id, depth)
  }

  // A folder's ring, in the padding between its border, below the label
  // strip, and its boxes, then its boxes inside the ring and the doors out.
  // A side with no padding has no ring channel.
  const placeFolder = (box: RouteBox, items: Item[], nb: Neighbours, depth: number) => {
    if (items.length === 0) return
    const b = toBand(box.rect)
    const top = Math.min(b.y0 + (box.header ?? 0), b.y1)
    const inner: Band = {
      x0: Math.max(b.x0, Math.min(...items.map((item) => item.band.x0))),
      y0: Math.max(top, Math.min(...items.map((item) => item.band.y0))),
      x1: Math.min(b.x1, Math.max(...items.map((item) => item.band.x1))),
      y1: Math.min(b.y1, Math.max(...items.map((item) => item.band.y1))),
    }
    const firstNew = graph.attachments.length
    const ring = (side: BlockSide, channel: Omit<Channel, 'container' | 'after' | 'ring'>) =>
      graph.channels.push({ ...channel, container: box.id, after: [], ring: side }) - 1
    // The sides run from the label strip down, and open out at the bottom.
    const side = (which: 'left' | 'right', low: number, high: number): number => {
      if (high <= low) return -1
      const index = ring(which, {
        axis: 'y',
        low,
        high,
        start: top,
        end: b.y1,
        depth,
        bars: [-1, nb[BOTTOM]],
      })
      if (nb[BOTTOM] >= 0) {
        attach({
          bar: nb[BOTTOM],
          isHigh: false,
          from: low,
          to: high,
          mouth: b.y1,
          channel: index,
          end: 1,
        })
      }
      return index
    }
    const left = side('left', b.x0, inner.x0)
    const right = side('right', inner.x1, b.x1)
    // The top and bottom run between the sides.
    const across = (which: 'top' | 'bottom', low: number, high: number): number => {
      if (high <= low) return -1
      const index = ring(which, {
        axis: 'x',
        low,
        high,
        start: inner.x0,
        end: inner.x1,
        depth: depth + 1,
        bars: [left, right],
      })
      if (left >= 0) {
        attach({
          bar: left,
          isHigh: true,
          from: low,
          to: high,
          mouth: inner.x0,
          channel: index,
          end: 0,
        })
      }
      if (right >= 0) {
        attach({
          bar: right,
          isHigh: false,
          from: low,
          to: high,
          mouth: inner.x1,
          channel: index,
          end: 1,
        })
      }
      return index
    }
    const upper = across('top', top, inner.y0)
    const lower = across('bottom', inner.y1, b.y1)
    // The top door: down through the strip right of the label, from the
    // channel above to the ring's top channel.
    if (upper >= 0 && nb[TOP] >= 0 && box.label !== undefined && top > b.y0) {
      const low = Math.max(inner.x0, b.x0 + box.label)
      const high = inner.x1
      if (holdsLane(low, high)) {
        const door =
          graph.channels.push({
            axis: 'y',
            low,
            high,
            start: b.y0,
            end: top,
            depth: depth + 1,
            container: box.id,
            after: [],
            bars: [nb[TOP], upper],
          }) - 1
        attach({
          bar: nb[TOP],
          isHigh: true,
          from: low,
          to: high,
          mouth: b.y0,
          channel: door,
          end: 0,
        })
        attach({
          bar: upper,
          isHigh: false,
          from: low,
          to: high,
          mouth: top,
          channel: door,
          end: 1,
        })
      }
    }
    split(inner, items, 'y', [upper, right, lower, left], box.id, depth + 2)
    // Doors: a channel end on the ring's left, right or bottom also runs on
    // across it into the channel outside, from the same mouth.
    const outside = new Map<number, number>()
    if (left >= 0 && nb[LEFT] >= 0) outside.set(left, nb[LEFT])
    if (right >= 0 && nb[RIGHT] >= 0) outside.set(right, nb[RIGHT])
    if (lower >= 0 && nb[BOTTOM] >= 0) outside.set(lower, nb[BOTTOM])
    const lastNew = graph.attachments.length
    for (let i = firstNew; i < lastNew; i++) {
      const a = graph.attachments[i] as Attachment
      const bar = outside.get(a.bar)
      if (a.channel !== undefined && bar !== undefined) attach({ ...a, bar })
    }
  }

  // A channel from low to high across `across`, the length of the band, with
  // its ends on the channels beside the band, from their high and low sides.
  const addChannel = (
    band: Band,
    across: Axis,
    low: number,
    high: number,
    nb: Neighbours,
    container: string,
    after: string[],
    depth: number,
  ): number => {
    const [, , startSide, endSide] = CUT_SIDES[across]
    const [start, end] = across === 'y' ? [band.x0, band.x1] : [band.y0, band.y1]
    const index =
      graph.channels.push({
        axis: across === 'y' ? 'x' : 'y',
        low,
        high,
        start,
        end,
        depth,
        container,
        after,
        bars: [nb[startSide], nb[endSide]],
      }) - 1
    if (nb[startSide] >= 0) {
      attach({
        bar: nb[startSide],
        isHigh: true,
        from: low,
        to: high,
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
        to: high,
        mouth: end,
        channel: index,
        end: 1,
      })
    }
    return index
  }

  // With edgeLanes: the axis across which a band's padding beside one item
  // holds a lane, if any.
  const paddedAxis = (band: Band, item: Item, preferred: Axis): Axis | undefined => {
    if (!edgeLanes) return undefined
    for (const across of [preferred, preferred === 'y' ? 'x' : 'y'] as const) {
      if (
        holdsLane(lowEdge(band, across), lowEdge(item.band, across)) ||
        holdsLane(highEdge(item.band, across), highEdge(band, across))
      ) {
        return across
      }
    }
    return undefined
  }

  const place = (item: Item, nb: Neighbours, depth: number) => {
    const { box } = item
    if (!box) return
    if (box.kids) placeContainer(box, nb, depth)
    else placeBlock(box, nb)
  }

  // Cuts a band across `across` (y: into horizontal strips) between groups of
  // items that do not overlap on that axis, then each group the other way.
  // When the items do not part that way, it cuts the other way instead.
  const split = (
    band: Band,
    items: Item[],
    preferred: Axis,
    nb: Neighbours,
    container: string,
    depth: number,
  ): void => {
    if (items.length === 0) return
    let cut: { across: Axis; groups: Group[] } | undefined
    if (items.length === 1) {
      const item = items[0] as Item
      const across = paddedAxis(band, item, preferred)
      if (!across) {
        place(item, nb, depth)
        return
      }
      cut = {
        across,
        groups: [{ start: lowEdge(item.band, across), end: highEdge(item.band, across), items }],
      }
    } else {
      cut = cutItems(items, preferred)
    }
    if (!cut) {
      // Not a row layout: leave these boxes without lanes.
      graph.stuck += items.length
      return
    }
    const { across, groups } = cut
    const [lowSide, highSide] = CUT_SIDES[across]
    const afterOf = (group: Group): string[] => {
      const after: string[] = []
      for (const item of group.items) {
        if (item.box && lowEdge(item.band, across) === group.start) after.push(item.box.id)
      }
      return after
    }
    // With edgeLanes, the channels in the padding before the first group and
    // after the last.
    const first = groups[0] as Group
    const last = groups[groups.length - 1] as Group
    const bandLow = lowEdge(band, across)
    const bandHigh = highEdge(band, across)
    const lowPad =
      edgeLanes && holdsLane(bandLow, first.start)
        ? addChannel(band, across, bandLow, first.start, nb, container, afterOf(first), depth)
        : nb[lowSide]
    const highPad =
      edgeLanes && holdsLane(last.end, bandHigh)
        ? addChannel(band, across, last.end, bandHigh, nb, container, [], depth)
        : nb[highSide]
    // The channel after each group, or -1 when the next group touches it.
    const between: number[] = []
    for (let g = 0; g + 1 < groups.length; g++) {
      const low = (groups[g] as Group).end
      const next = groups[g + 1] as Group
      if (next.start <= low) {
        between.push(-1)
        continue
      }
      between.push(addChannel(band, across, low, next.start, nb, container, afterOf(next), depth))
    }
    groups.forEach((group, g) => {
      const piece: Band =
        across === 'y'
          ? { ...band, y0: group.start, y1: group.end }
          : { ...band, x0: group.start, x1: group.end }
      const pieceNb: Neighbours = [...nb]
      pieceNb[lowSide] = g === 0 ? lowPad : (between[g - 1] as number)
      pieceNb[highSide] = g === groups.length - 1 ? highPad : (between[g] as number)
      split(piece, group.items, across === 'y' ? 'x' : 'y', pieceNb, container, depth + 1)
    })
  }

  // A ring of channels around the whole map, so that a row with one wide
  // block in it never cuts the map in two: lines can always go round.
  const band = toBand(root.rect)
  const ring = (channel: Omit<Channel, 'container' | 'after'>) =>
    graph.channels.push({ ...channel, container: root.id, after: [] }) - 1
  const left = ring({
    axis: 'y',
    low: band.x0 - ringUnits,
    high: band.x0,
    start: band.y0 - ringUnits,
    end: band.y1 + ringUnits,
    depth: -2,
    bars: [-1, -1],
  })
  const right = ring({
    axis: 'y',
    low: band.x1,
    high: band.x1 + ringUnits,
    start: band.y0 - ringUnits,
    end: band.y1 + ringUnits,
    depth: -2,
    bars: [-1, -1],
  })
  for (const [low, high] of [
    [band.y0 - ringUnits, band.y0],
    [band.y1, band.y1 + ringUnits],
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
  graph.around = { top, right, bottom, left }
  place({ band, box: root }, [top, right, bottom, left], 0)
  return graph
}

interface Group {
  start: number
  end: number
  items: Item[]
}

// Where to cut a set of items: across the preferred axis or else the other,
// between groups with a real gap first. Only when no gap parts them, at edges
// that merely touch: such a cut holds no channel, so the block sides along it
// get no lanes and the channels on either side cannot reach each other.
function cutItems(items: Item[], preferred: Axis): { across: Axis; groups: Group[] } | undefined {
  const other: Axis = preferred === 'y' ? 'x' : 'y'
  for (const isTouchingApart of [false, true]) {
    for (const across of [preferred, other]) {
      const groups = groupItems(items, across, isTouchingApart)
      if (groups.length > 1) return { across, groups }
    }
  }
  return undefined
}

// Items in runs that overlap on one axis. Touching runs join, unless
// isTouchingApart.
function groupItems(items: Item[], across: Axis, isTouchingApart: boolean): Group[] {
  const sorted = [...items].sort((a, b) => lowEdge(a.band, across) - lowEdge(b.band, across))
  const groups: Group[] = []
  for (const item of sorted) {
    const lo = lowEdge(item.band, across)
    const hi = highEdge(item.band, across)
    const last = groups[groups.length - 1]
    if (last && (lo < last.end || (!isTouchingApart && lo === last.end))) {
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

// Whether a free strip from low to high holds a whole-unit lane.
function holdsLane(low: number, high: number): boolean {
  return Math.ceil(high) - Math.floor(low) - 1 > 0
}

// Lanes a channel holds stride units apart: the multiples of stride strictly
// inside it.
export function laneCapacity(channel: Channel, stride = 1): number {
  return Math.max(0, Math.ceil(channel.high / stride) - Math.floor(channel.low / stride) - 1)
}

// Every box's place in the tree, depth first.
function nestBoxes(root: RouteBox): Map<string, BoxNest> {
  const nest = new Map<string, BoxNest>()
  let order = 0
  const visit = (box: RouteBox, parent: string | undefined) => {
    const entry: BoxNest = {
      parent,
      order: order++,
      end: 0,
      isScope: parent === undefined || (box.kids !== undefined && (box.header ?? 0) > 0),
    }
    nest.set(box.id, entry)
    for (const kid of box.kids ?? []) visit(kid, box.id)
    entry.end = order
  }
  visit(root, undefined)
  return nest
}
