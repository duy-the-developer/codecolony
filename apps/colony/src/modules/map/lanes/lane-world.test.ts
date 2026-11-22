import { describe, expect, it } from 'vitest'
import type { RouteNode } from '../../lane-routing/route-boxes.ts'
import { FILE_LANE_PITCH, type LaneEdge, LaneWorld } from './lane-world.ts'

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

function listPoints(world: LaneWorld, open: string[]): number[] {
  const routes = world.route(open.join(','), open)
  return [...routes.points.subarray(routes.offsets[0], routes.offsets[1])]
}

describe('LaneWorld', () => {
  it('keeps a module of files one block until its files open', () => {
    const world = new LaneWorld(NODES, EDGES)
    expect(world.describeLevel('r', ['r']).links).toEqual([])
    expect(world.route('r', ['r']).pitch).toBe(1)
  })

  it('routes between open files on a finer pitch, in grid units', () => {
    const world = new LaneWorld(NODES, EDGES)
    const open = ['r', 'r/m']
    expect(world.describeLevel(open.join(','), open).links).toEqual([
      { from: 'r/m/a.ts', to: 'r/m/b.ts' },
    ])
    expect(world.route(open.join(','), open).pitch).toBe(FILE_LANE_PITCH)
    // From a's right side, along the middle of the street, to b's left side,
    // half a unit off the spot where a's line leaves.
    expect(listPoints(world, open)).toEqual([4, 4, 4.5, 4, 4.5, 3.5, 5, 3.5])
  })

  // world > repo r > folder r/src, with module core up on the right and
  // module util down on the left, a 1-unit pad from src's left wall.
  it('keeps a file wire inside the folder when its padding holds a lane', () => {
    const file = (id: string, x: number, y: number): RouteNode => ({
      id,
      parent: id.slice(0, id.lastIndexOf('/')),
      kind: 'file',
      rect: { x, y, w: 1, h: 1 },
    })
    const nodes: RouteNode[] = [
      { id: 'world', kind: 'world', rect: { x: 0, y: 0, w: 26, h: 22 } },
      { id: 'r', parent: 'world', kind: 'repo', rect: { x: 1, y: 2, w: 24, h: 19 } },
      { id: 'r/src', parent: 'r', kind: 'module', rect: { x: 2, y: 4, w: 19, h: 16 } },
      { id: 'r/src/core', parent: 'r/src', kind: 'module', rect: { x: 13, y: 5, w: 5, h: 6 } },
      { id: 'r/src/util', parent: 'r/src', kind: 'module', rect: { x: 3, y: 13, w: 5, h: 6 } },
      file('r/src/core/c1.ts', 14, 6),
      file('r/src/core/c2.ts', 14, 8),
      file('r/src/core/c3.ts', 16, 6),
      file('r/src/util/u1.ts', 4, 14),
      file('r/src/util/u2.ts', 4, 16),
      file('r/src/util/u3.ts', 6, 14),
    ]
    const world = new LaneWorld(nodes, [['r/src/core/c2.ts', 'r/src/util/u2.ts']])
    const points = listPoints(world, ['r', 'r/src', 'r/src/core', 'r/src/util'])
    expect(points.length).toBeGreaterThan(0)
    for (let k = 0; k < points.length; k += 2) {
      const x = points[k] as number
      const y = points[k + 1] as number
      expect(x >= 2 && x <= 21 && y >= 4 && y <= 20, `${x},${y}`).toBe(true)
    }
  })
})
