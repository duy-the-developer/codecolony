import { buildChannelGraph, type ChannelGraph, type RouteBox } from './channel-graph.ts'
import { buildRouteBoxes, type RouteBoxes, type RouteNode } from './route-boxes.ts'

// The channels the Dependency overlay's lines are routed through, and the
// layout makes room for: every folder and module open, so every file is a
// block, and every length times FILE_LANE_PITCH, so a 1-unit file street
// holds a lane.

// Lanes per grid unit.
export const FILE_LANE_PITCH = 2

// Width of the ring of channels around the whole map, in units.
const RING_UNITS = 8

export interface FileGraph {
  boxes: RouteBoxes
  // In units of 1 / FILE_LANE_PITCH; undefined when there is no world.
  graph: ChannelGraph | undefined
}

export function buildFileGraph(nodes: readonly RouteNode[]): FileGraph {
  const boxes = buildRouteBoxes(
    nodes,
    () => true,
    () => true,
  )
  const graph = boxes.root
    ? buildChannelGraph(scaleBox(boxes.root, FILE_LANE_PITCH), true, RING_UNITS * FILE_LANE_PITCH)
    : undefined
  return { boxes, graph }
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
