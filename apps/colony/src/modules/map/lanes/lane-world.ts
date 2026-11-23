import { buildChannelGraph, type RouteBox } from '../../lane-routing/channel-graph.ts'
import { buildRouteBoxes, type RouteNode } from '../../lane-routing/route-boxes.ts'
import { type Link, routeLanes } from '../../lane-routing/route-lanes.ts'

// The Dependency overlay's routing for one world version, run in a worker
// (lane-worker.ts) so routing a large world never stalls the map. Like wiring
// on a circuit board, every line is worked out once, in world units, from the
// layout alone, never from the camera.
//
// Imports are always between files, so lines are too: one line per importing
// and imported file, in one piece, from a side of the one to a side of the
// other. Every file is a block (route-boxes.ts with every folder and module
// open), and the whole world is routed at once on a half-unit pitch, so a
// 1-unit file street holds a lane. Where a channel has room, lines sit a
// whole unit apart. A line stays inside the deepest open folder that holds
// both its files and crosses a folder's border straight on, through a door
// (channel-graph.ts); lines share a lane only when they import the same file
// and there is no room for both.

// An import edge, by the ids of its ends.
export type LaneEdge = readonly [from: string, to: string]

export interface LaneRoutes {
  // The links routed, as indices into the links of their routing.
  links: Int32Array
  // Each routed link's corner points x0, y0, x1, y1, ... are
  // points[offsets[i]] up to points[offsets[i + 1]]; empty when it has no path.
  points: Float64Array
  offsets: Int32Array
  // Lanes per grid unit: lanes sit 1 / pitch units apart at the closest.
  pitch: number
}

export interface FileLines {
  // One link per importing and imported file.
  links: Link[]
  // Every link, from the importer's side to a side of the file it imports.
  routes: LaneRoutes
  // Per link, the import edges (indices in the order given to LaneWorld) it
  // carries: edges[edgeOffsets[i]] up to edges[edgeOffsets[i + 1]].
  edgeOffsets: Int32Array
  edges: Int32Array
}

// Lanes per grid unit.
export const FILE_LANE_PITCH = 2

export class LaneWorld {
  private readonly nodes: readonly RouteNode[]
  private readonly edges: readonly LaneEdge[]
  private lines: FileLines | undefined

  constructor(nodes: readonly RouteNode[], edges: readonly LaneEdge[]) {
    this.nodes = nodes
    this.edges = edges
  }

  // Every line, routed on first use and kept.
  routeFiles(): FileLines {
    if (this.lines) return this.lines
    const pitch = FILE_LANE_PITCH
    const boxes = buildRouteBoxes(
      this.nodes,
      () => true,
      () => true,
    )
    const links: Link[] = []
    const carried: number[][] = []
    const index = new Map<string, number>()
    this.edges.forEach(([from, to], e) => {
      const a = boxes.blockOf(from)
      const b = boxes.blockOf(to)
      if (!a || !b || a === b) return
      const key = `${a}\n${b}`
      let link = index.get(key)
      if (link === undefined) {
        link = links.push({ from: a, to: b }) - 1
        carried.push([])
        index.set(key, link)
      }
      carried[link]?.push(e)
    })
    let routes = emptyRoutes(pitch)
    if (boxes.root && links.length > 0) {
      const graph = buildChannelGraph(scaleBox(boxes.root, pitch), true, RING_UNITS * pitch)
      const routing = routeLanes(graph, links, { merge: 'whenFull', stride: pitch })
      routes = packRoutes(routing.points, pitch)
    }
    const edgeOffsets = new Int32Array(links.length + 1)
    carried.forEach((list, i) => {
      edgeOffsets[i + 1] = (edgeOffsets[i] as number) + list.length
    })
    this.lines = { links, routes, edgeOffsets, edges: Int32Array.from(carried.flat()) }
    return this.lines
  }
}

// Width of the ring of channels around the whole map, in units.
const RING_UNITS = 8

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

// A box tree with every length times k.
function scaleBox(box: RouteBox, k: number): RouteBox {
  if (k === 1) return box
  const { x, y, w, h } = box.rect
  const scaled: RouteBox = { id: box.id, rect: { x: x * k, y: y * k, w: w * k, h: h * k } }
  if (box.header !== undefined) scaled.header = box.header * k
  if (box.kids) scaled.kids = box.kids.map((kid) => scaleBox(kid, k))
  return scaled
}
