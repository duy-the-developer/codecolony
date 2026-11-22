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
})
