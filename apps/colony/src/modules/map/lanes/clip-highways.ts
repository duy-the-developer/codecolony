import type { Rect } from '../../world/world-types.ts'
import type { DrawnLevel, LinkCache } from '../link-cache.ts'
import type { Highways, LaneRoutes } from './lane-world.ts'

// The highways (lane-world.ts) as drawn at one zoom level. Their routes never
// change; a block that is not drawn at the level stands for its deepest
// drawn container, which is drawn closed, and a highway ends where it crosses
// that container's border. A highway whose ends fall in one drawn block, or
// whose one end holds the other, is not drawn. The level depends only on
// the scale, so panning never changes what is drawn, and a highway drawn at
// two levels has the same corners wherever both draw it.

// What a block's lines end on at a level: its node, drawn as itself, or the
// closed container drawn for it; for a folder's own files, the folder.
interface StandIn {
  node: number
  // The block itself is drawn, so the route is drawn to its end.
  isSelf: boolean
  // A folder's own files, drawn inside the open folder `node`.
  isFiles: boolean
}

// Rounding slack for points on a border.
const EPSILON = 1e-9

export function clipHighways(highways: Highways, links: LinkCache, drawn: DrawnLevel): LaneRoutes {
  const { routes } = highways
  const standIns = new Map<string, StandIn | undefined>()
  const standInOf = (block: string): StandIn | undefined => {
    if (standIns.has(block)) return standIns.get(block)
    const found = findStandIn(block, links, drawn)
    standIns.set(block, found)
    return found
  }
  const kept: number[] = []
  const pieces: Float64Array[] = []
  highways.links.forEach((link, i) => {
    const start = routes.offsets[i] as number
    const end = routes.offsets[i + 1] as number
    if (end <= start) return
    const a = standInOf(link.from)
    const b = standInOf(link.to)
    if (!a || !b || holds(a, b, links) || holds(b, a, links)) return
    const points = routes.points.subarray(start, end)
    const clipped = clipRoute(
      points,
      a.isSelf ? undefined : links.rectAt(a.node),
      b.isSelf ? undefined : links.rectAt(b.node),
    )
    if (!clipped) return
    kept.push(i)
    pieces.push(clipped)
  })
  const offsets = new Int32Array(kept.length + 1)
  pieces.forEach((piece, k) => {
    offsets[k + 1] = (offsets[k] as number) + piece.length
  })
  const points = new Float64Array(offsets[kept.length] as number)
  pieces.forEach((piece, k) => {
    points.set(piece, offsets[k] as number)
  })
  return { links: Int32Array.from(kept), points, offsets, pitch: routes.pitch }
}

function findStandIn(block: string, links: LinkCache, drawn: DrawnLevel): StandIn | undefined {
  const { visible, isOpen } = drawn
  const hash = block.indexOf('#')
  const isFiles = hash >= 0
  let i = links.indexOf(isFiles ? block.slice(0, hash) : block)
  if (i === undefined) return undefined
  if (isFiles ? visible[i] && isOpen[i] : visible[i]) return { node: i, isSelf: true, isFiles }
  while (i >= 0 && !visible[i]) i = links.parentIndex(i)
  return i < 0 ? undefined : { node: i, isSelf: false, isFiles: false }
}

// Whether a's drawn block holds b's, or is it: a folder's own files hold only
// themselves, and a container holds its own files.
function holds(a: StandIn, b: StandIn, links: LinkCache): boolean {
  if (a.isFiles) return b.isFiles && a.node === b.node
  for (let i = b.node; i >= 0; i = links.parentIndex(i)) if (i === a.node) return true
  return false
}

// A route cut where it leaves `from` and where it enters `to`. Routes leave
// a box only through its border once, and enter one once, so the first point
// out of `from` and the last point before `to` are the cuts. Undefined when
// nothing is left.
function clipRoute(
  points: Float64Array,
  from: Rect | undefined,
  to: Rect | undefined,
): Float64Array | undefined {
  const count = points.length / 2
  let first = 0
  let head: [number, number] | undefined
  if (from) {
    let k = 0
    while (k + 1 < count && isInside(points, k + 1, from)) k++
    if (k + 1 >= count) return undefined
    head = crossing(points, k, from)
    first = k + 1
  }
  let last = count - 1
  let tail: [number, number] | undefined
  if (to) {
    let k = count - 1
    while (k - 1 >= 0 && isInside(points, k - 1, to)) k--
    if (k - 1 < 0) return undefined
    tail = crossing(points, k, to, k - 1)
    last = k - 1
  }
  if (last < first - 1) return undefined
  const out: number[] = []
  if (head) out.push(head[0], head[1])
  for (let k = first; k <= last; k++) out.push(points[2 * k] as number, points[2 * k + 1] as number)
  if (tail) out.push(tail[0], tail[1])
  return out.length >= 4 ? Float64Array.from(out) : undefined
}

function isInside(points: Float64Array, k: number, rect: Rect): boolean {
  const x = points[2 * k] as number
  const y = points[2 * k + 1] as number
  return (
    x >= rect.x - EPSILON &&
    x <= rect.x + rect.w + EPSILON &&
    y >= rect.y - EPSILON &&
    y <= rect.y + rect.h + EPSILON
  )
}

// Where the straight line from point k (inside rect) to point `toward`
// (outside it, k + 1 by default) crosses the rect's border.
function crossing(points: Float64Array, k: number, rect: Rect, toward = k + 1): [number, number] {
  const x0 = points[2 * k] as number
  const y0 = points[2 * k + 1] as number
  const x1 = points[2 * toward] as number
  const y1 = points[2 * toward + 1] as number
  if (x0 === x1) return [x0, y1 < y0 ? rect.y : rect.y + rect.h]
  return [x1 < x0 ? rect.x : rect.x + rect.w, y0]
}
