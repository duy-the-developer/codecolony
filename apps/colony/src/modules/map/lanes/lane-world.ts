import {
  type Attachment,
  type BlockSide,
  buildChannelGraph,
  type ChannelGraph,
  type RouteBox,
} from '../../lane-routing/channel-graph.ts'
import { buildRouteBoxes, type RouteNode } from '../../lane-routing/route-boxes.ts'
import { type Link, routeLanes } from '../../lane-routing/route-lanes.ts'
import { HEADER_UNITS, type Rect } from '../../world/world-types.ts'

// The Dependency overlay's routing for one world version, run in a worker
// (lane-worker.ts) so routing a large world never stalls the map. Like wiring
// on a circuit board, every route is worked out once, in world units, from the
// layout alone, never from the camera:
//
// - Highways run between blocks: modules of files, and the files a folder
//   holds beside its subfolders, taken together (route-boxes.ts with every
//   folder open). They are routed once for the whole world, through the
//   gutters and rings the layout widened for them, a lane per grid unit.
// - Inside each such holder of files, the links between its own files, and a
//   tail from each highway's port on its border to every file the highway
//   serves, are routed on their own, only inside the holder and half a unit
//   around it, on a half-unit pitch: a 1-unit file street holds one lane. A
//   holder is routed the first time the page asks for it and kept.
//
// Highways sit on whole units and tails on half units off a holder's sides,
// so the two never share a lane; a tail joins its highway at the port.

// An import edge, by the ids of its ends.
export type LaneEdge = readonly [from: string, to: string]

export interface LaneRoutes {
  // The links routed, as indices into the links of their routing.
  links: Int32Array
  // Each routed link's corner points x0, y0, x1, y1, ... are
  // points[offsets[i]] up to points[offsets[i + 1]]; empty when it has no path.
  points: Float64Array
  offsets: Int32Array
  // Lanes per grid unit: lanes sit 1 / pitch units apart.
  pitch: number
  // Per routed link, whether its last point gets an arrowhead; every link's
  // does when missing.
  arrows?: Uint8Array
}

export interface Highways {
  // Links between blocks, one per importing and imported block.
  links: Link[]
  // Per import edge (in the order given to LaneWorld), its link, or -1 when
  // both ends fall in one block.
  linkOfEdge: Int32Array
  // Every link, from the importer's side to the imported block's side.
  routes: LaneRoutes
}

export interface HolderRoutes {
  // The block id of the holder (route-boxes.ts).
  holder: string
  // Its links between files, and its tails from a file to a highway's port
  // or from a port to a file, in the direction the imports run. Only lines
  // that end on a file get an arrowhead.
  routes: LaneRoutes
  // Per routed link, the import edges it carries:
  // edges[edgeOffsets[i]] up to edges[edgeOffsets[i + 1]].
  edgeOffsets: Int32Array
  edges: Int32Array
}

// Lanes per grid unit inside a holder of files.
export const FILE_LANE_PITCH = 2
// Width of the ring of lanes around a holder, in units: half a unit off its
// sides, between it and the highways' first whole-unit lane.
const HOLDER_RING_UNITS = 1
// A port is a point: the lane on it is the one whole pitch unit at it.
const PORT_SLACK = 1e-6

interface HighwayWorld {
  highways: Highways
  blockOf: (id: string) => string | undefined
  // Block id -> the import edges with an end in it.
  edgesOf: Map<string, number[]>
}

export class LaneWorld {
  private readonly nodes: readonly RouteNode[]
  private readonly edges: readonly LaneEdge[]
  private readonly byId: Map<string, RouteNode>
  private world: HighwayWorld | undefined

  constructor(nodes: readonly RouteNode[], edges: readonly LaneEdge[]) {
    this.nodes = nodes
    this.edges = edges
    this.byId = new Map(nodes.map((node) => [node.id, node]))
  }

  // Every highway, routed on first use.
  routeHighways(): Highways {
    return this.resolveWorld().highways
  }

  // The links and tails inside one holder of files.
  routeHolder(holder: string): HolderRoutes {
    const { highways, blockOf, edgesOf } = this.resolveWorld()
    const files = this.nodes.filter((node) => node.kind === 'file' && blockOf(node.id) === holder)
    const box = this.holderBox(holder, files)
    const empty: HolderRoutes = {
      holder,
      routes: emptyRoutes(FILE_LANE_PITCH),
      edgeOffsets: new Int32Array(1),
      edges: new Int32Array(0),
    }
    if (!box) return empty
    const pitch = FILE_LANE_PITCH
    const graph = buildChannelGraph(scaleBox(box, pitch), true, HOLDER_RING_UNITS * pitch)

    // Lines to route: file to file, and file to port. A tail into the holder
    // is routed from its file and turned round, so every tail to one port
    // has the same end and may share its lane.
    const links: Link[] = []
    const isInward: boolean[] = []
    const carried: number[][] = []
    const index = new Map<string, number>()
    const ports = new Map<number, string | undefined>()
    const add = (from: string, to: string, inward: boolean, edge: number) => {
      const key = `${from}\n${to}\n${inward}`
      let i = index.get(key)
      if (i === undefined) {
        i = links.push({ from, to }) - 1
        isInward.push(inward)
        carried.push([])
        index.set(key, i)
      }
      carried[i]?.push(edge)
    }
    for (const e of edgesOf.get(holder) ?? []) {
      const [from, to] = this.edges[e] as LaneEdge
      const fromFile = fileId(from)
      const toFile = fileId(to)
      const link = highways.linkOfEdge[e] as number
      if (link < 0) {
        if (fromFile !== toFile) add(fromFile, toFile, false, e)
        continue
      }
      const isOut = blockOf(from) === holder
      let port = ports.get(link)
      if (!ports.has(link)) {
        port = this.attachPort(graph, box, highways.routes, link, isOut, pitch)
        ports.set(link, port)
      }
      if (port) add(isOut ? fromFile : toFile, port, !isOut, e)
    }

    const routing = routeLanes(graph, links, { merge: 'whenFull' })
    const offsets = new Int32Array(links.length + 1)
    let total = 0
    routing.points.forEach((points, i) => {
      total += points?.length ?? 0
      offsets[i + 1] = total
    })
    const points = new Float64Array(total)
    routing.points.forEach((p, i) => {
      if (!p) return
      const at = offsets[i] as number
      if (!isInward[i]) {
        points.set(p, at)
        return
      }
      for (let k = 0; k < p.length; k += 2) {
        points[at + k] = p[p.length - 2 - k] as number
        points[at + k + 1] = p[p.length - 1 - k] as number
      }
    })
    for (let k = 0; k < total; k++) points[k] = (points[k] as number) / pitch
    const arrows = new Uint8Array(links.length)
    links.forEach((link, i) => {
      arrows[i] = isInward[i] || !isPort(link.to) ? 1 : 0
    })
    const edgeOffsets = new Int32Array(links.length + 1)
    carried.forEach((list, i) => {
      edgeOffsets[i + 1] = (edgeOffsets[i] as number) + list.length
    })
    return {
      holder,
      routes: {
        links: Int32Array.from(links, (_, i) => i),
        points,
        offsets,
        pitch,
        arrows,
      },
      edgeOffsets,
      edges: Int32Array.from(carried.flat()),
    }
  }

  private resolveWorld(): HighwayWorld {
    if (this.world) return this.world
    const boxes = buildRouteBoxes(this.nodes)
    const links: Link[] = []
    const index = new Map<string, number>()
    const linkOfEdge = new Int32Array(this.edges.length).fill(-1)
    const edgesOf = new Map<string, number[]>()
    const note = (block: string, e: number) => {
      const list = edgesOf.get(block)
      if (list) list.push(e)
      else edgesOf.set(block, [e])
    }
    this.edges.forEach(([from, to], e) => {
      const a = boxes.blockOf(from)
      const b = boxes.blockOf(to)
      if (!a || !b) return
      note(a, e)
      if (a === b) return
      note(b, e)
      const key = `${a}\n${b}`
      let link = index.get(key)
      if (link === undefined) {
        link = links.push({ from: a, to: b }) - 1
        index.set(key, link)
      }
      linkOfEdge[e] = link
    })
    let routes = emptyRoutes(1)
    if (boxes.root) {
      const routing = routeLanes(buildChannelGraph(boxes.root), links, { merge: 'whenFull' })
      routes = packRoutes(routing.points, 1)
    }
    this.world = { highways: { links, linkOfEdge, routes }, blockOf: boxes.blockOf, edgesOf }
    return this.world
  }

  // A holder as a box of its files: a module of files with its label strip
  // and padding, or a folder's own files with neither.
  private holderBox(holder: string, files: readonly RouteNode[]): RouteBox | undefined {
    if (files.length === 0) return undefined
    const kids = files.map((file) => ({ id: file.id, rect: file.rect }))
    const node = this.byId.get(holder)
    if (node) return { id: holder, rect: node.rect, header: HEADER_UNITS[node.kind], kids }
    return { id: holder, rect: boundsOf(files), header: 0, kids }
  }

  // Adds the port where a highway meets the holder as a block of its own,
  // a point on the holder's border, and returns its id; undefined when the
  // highway has no route. A module's tails reach a port on its left, right
  // or bottom through the ring inside its padding; any other port, through
  // the ring half a unit outside the holder, because nothing crosses a label
  // strip and a folder's own files have no padding.
  private attachPort(
    graph: ChannelGraph,
    box: RouteBox,
    routes: LaneRoutes,
    link: number,
    isOut: boolean,
    pitch: number,
  ): string | undefined {
    const start = routes.offsets[link] as number
    const end = routes.offsets[link + 1] as number
    if (end <= start) return undefined
    const at = isOut ? start : end - 2
    const x = routes.points[at] as number
    const y = routes.points[at + 1] as number
    const { rect } = box
    const side: BlockSide =
      x === rect.x ? 'left' : x === rect.x + rect.w ? 'right' : y === rect.y ? 'top' : 'bottom'
    const isAcross = side === 'left' || side === 'right'
    const along = (isAcross ? y : x) * pitch
    const border = (isAcross ? x : y) * pitch
    const inner =
      (box.header ?? 0) > 0 && side !== 'top'
        ? graph.channels.findIndex((c) => c.container === box.id && c.ring === side)
        : -1
    // The holder's side is the high side of the ring to its left or above
    // it, and of its own ring channels on its right and bottom.
    const bar = inner >= 0 ? inner : graph.around[side]
    const isHigh = inner >= 0 ? side !== 'left' : side === 'left' || side === 'top'
    const id = `${box.id}#port${link}`
    const attachment: Attachment = {
      bar,
      isHigh,
      from: along - PORT_SLACK,
      to: along + PORT_SLACK,
      mouth: border,
      block: id,
      side,
    }
    graph.attachments.push(attachment)
    return id
  }
}

function emptyRoutes(pitch: number): LaneRoutes {
  return {
    links: new Int32Array(0),
    points: new Float64Array(0),
    offsets: new Int32Array(1),
    pitch,
  }
}

// Routed points as one flat array, every link in order, in grid units.
function packRoutes(routed: readonly (Float64Array | undefined)[], pitch: number): LaneRoutes {
  const offsets = new Int32Array(routed.length + 1)
  let total = 0
  routed.forEach((points, i) => {
    total += points?.length ?? 0
    offsets[i + 1] = total
  })
  const points = new Float64Array(total)
  routed.forEach((p, i) => {
    if (p) points.set(p, offsets[i] as number)
  })
  if (pitch !== 1) for (let k = 0; k < total; k++) points[k] = (points[k] as number) / pitch
  return { links: Int32Array.from(routed, (_, i) => i), points, offsets, pitch }
}

// The file that holds an edge end, which may be a symbol in it.
function fileId(id: string): string {
  const hash = id.indexOf('#')
  return hash < 0 ? id : id.slice(0, hash)
}

function isPort(id: string): boolean {
  return id.includes('#port')
}

function boundsOf(nodes: readonly RouteNode[]): Rect {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const { rect } of nodes) {
    x0 = Math.min(x0, rect.x)
    y0 = Math.min(y0, rect.y)
    x1 = Math.max(x1, rect.x + rect.w)
    y1 = Math.max(y1, rect.y + rect.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// A box tree with every length times k.
function scaleBox(box: RouteBox, k: number): RouteBox {
  if (k === 1) return box
  const { x, y, w, h } = box.rect
  const scaled: RouteBox = { id: box.id, rect: { x: x * k, y: y * k, w: w * k, h: h * k } }
  if (box.header !== undefined) scaled.header = box.header * k
  if (box.kids) scaled.kids = box.kids.map((kid) => scaleBox(kid, k))
  return scaled
}
