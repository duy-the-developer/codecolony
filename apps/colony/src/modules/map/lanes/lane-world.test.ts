import { describe, expect, it } from 'vitest'
import type { RouteNode } from '../../lane-routing/route-boxes.ts'
import { FILE_LANE_PITCH, type LaneEdge, type LaneRoutes, LaneWorld } from './lane-world.ts'

// world > repo r > module m of two 2-unit files with a 1-unit street between
// them, at x 4 to 5.
const NODES: RouteNode[] = [
  { id: 'world', kind: 'world', rect: { x: 0, y: 0, w: 12, h: 10 } },
  { id: 'r', parent: 'world', kind: 'repo', rect: { x: 0, y: 0, w: 12, h: 10 } },
  { id: 'r/m', parent: 'r', kind: 'module', rect: { x: 1, y: 2, w: 7, h: 4 } },
  { id: 'r/m/a.ts', parent: 'r/m', kind: 'file', rect: { x: 2, y: 3, w: 2, h: 2 } },
  { id: 'r/m/b.ts', parent: 'r/m', kind: 'file', rect: { x: 5, y: 3, w: 2, h: 2 } },
]
const EDGES: LaneEdge[] = [['r/m/a.ts', 'r/m/b.ts']]

function listPoints(routes: LaneRoutes, i: number): number[] {
  return [...routes.points.subarray(routes.offsets[i], routes.offsets[i + 1])]
}

const file = (id: string, x: number, y: number): RouteNode => ({
  id,
  parent: id.slice(0, id.lastIndexOf('/')),
  kind: 'file',
  rect: { x, y, w: 1, h: 1 },
})

// world > repo r > folder r/src, with module core up on the right, module
// util down on the left and a file of src's own, src/main.ts, down on the
// right.
const FOLDER: RouteNode[] = [
  { id: 'world', kind: 'world', rect: { x: 0, y: 0, w: 26, h: 22 } },
  { id: 'r', parent: 'world', kind: 'repo', rect: { x: 1, y: 2, w: 24, h: 19 } },
  { id: 'r/src', parent: 'r', kind: 'module', rect: { x: 2, y: 4, w: 19, h: 16 } },
  { id: 'r/src/core', parent: 'r/src', kind: 'module', rect: { x: 13, y: 5, w: 5, h: 6 } },
  { id: 'r/src/util', parent: 'r/src', kind: 'module', rect: { x: 3, y: 13, w: 5, h: 6 } },
  file('r/src/main.ts', 15, 15),
  file('r/src/core/c1.ts', 14, 6),
  file('r/src/core/c2.ts', 14, 8),
  file('r/src/core/c3.ts', 16, 6),
  file('r/src/util/u1.ts', 4, 14),
  file('r/src/util/u2.ts', 4, 16),
  file('r/src/util/u3.ts', 6, 14),
]

describe('LaneWorld', () => {
  it('keeps the files of a module out of the highways', () => {
    const world = new LaneWorld(NODES, EDGES)
    const highways = world.routeHighways()
    expect(highways.links).toEqual([])
    expect(highways.linkOfEdge).toEqual(Int32Array.from([-1]))
    expect(highways.routes.pitch).toBe(1)
  })

  it('routes between the files of a holder on a finer pitch, in grid units', () => {
    const world = new LaneWorld(NODES, EDGES)
    const { routes, edgeOffsets, edges } = world.routeHolder('r/m')
    expect(routes.pitch).toBe(FILE_LANE_PITCH)
    expect([...edges.subarray(edgeOffsets[0], edgeOffsets[1])]).toEqual([0])
    // From a's right side, along the middle of the street, to b's left side,
    // half a unit off the spot where a's line leaves.
    expect(listPoints(routes, 0)).toEqual([4, 4, 4.5, 4, 4.5, 3.5, 5, 3.5])
    expect(routes.arrows?.[0]).toBe(1)
  })

  it('joins each tail to its highway at the port on the holder', () => {
    const edges: LaneEdge[] = [
      ['r/src/core/c2.ts', 'r/src/util/u2.ts'],
      ['r/src/core/c1.ts', 'r/src/util/u2.ts'],
      ['r/src/main.ts', 'r/src/core/c3.ts'],
    ]
    const world = new LaneWorld(FOLDER, edges)
    const { links, linkOfEdge, routes } = world.routeHighways()
    expect(links).toEqual([
      { from: 'r/src/core', to: 'r/src/util' },
      { from: 'r/src#files', to: 'r/src/core' },
    ])
    expect(linkOfEdge).toEqual(Int32Array.from([0, 0, 1]))
    const coreToUtil = listPoints(routes, 0)
    const start = coreToUtil.slice(0, 2)
    const end = coreToUtil.slice(-2)

    // In core, a tail from each of c1 and c2 out to the port; neither has an
    // arrowhead, as the imports go on along the highway.
    const core = world.routeHolder('r/src/core')
    const tails = [0, 1, 2]
      .map((i) => listPoints(core.routes, i))
      .filter((points) => points.length > 0)
    const outTo = core.routes.links.filter((_, i) => {
      const points = listPoints(core.routes, i)
      return points.at(-2) === start[0] && points.at(-1) === start[1]
    })
    expect(outTo.length).toBe(2)
    for (const i of outTo) expect(core.routes.arrows?.[i]).toBe(0)
    expect(tails.length).toBe(3)

    // In util, one tail from the port to u2, ending on it with an arrow.
    const util = world.routeHolder('r/src/util')
    expect(util.routes.links.length).toBe(1)
    const tail = listPoints(util.routes, 0)
    expect(tail.slice(0, 2)).toEqual(end)
    expect(util.routes.arrows?.[0]).toBe(1)
    // Every point stays inside util or half a unit around it.
    for (let k = 0; k < tail.length; k += 2) {
      const [x, y] = [tail[k] as number, tail[k + 1] as number]
      expect(x >= 2.5 && x <= 8.5 && y >= 12.5 && y <= 19.5, `${x},${y}`).toBe(true)
    }
  })

  it('routes the same holder the same, whatever was routed before', () => {
    const edges: LaneEdge[] = [
      ['r/src/core/c2.ts', 'r/src/util/u2.ts'],
      ['r/src/util/u1.ts', 'r/src/util/u3.ts'],
      ['r/src/main.ts', 'r/src/util/u1.ts'],
    ]
    const first = new LaneWorld(FOLDER, edges)
    first.routeHolder('r/src/core')
    first.routeHolder('r/src#files')
    const before = first.routeHolder('r/src/util')
    const after = new LaneWorld(FOLDER, edges).routeHolder('r/src/util')
    expect([...after.routes.points]).toEqual([...before.routes.points])
    expect([...after.routes.offsets]).toEqual([...before.routes.offsets])
  })
})
