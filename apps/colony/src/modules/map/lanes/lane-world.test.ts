import { describe, expect, it } from 'vitest'
import { FILE_LANE_PITCH } from '../../lane-routing/file-graph.ts'
import type { RouteNode } from '../../lane-routing/route-boxes.ts'
import type { Rect } from '../../world/world-types.ts'
import { type LaneEdge, type LaneRoutes, LaneWorld } from './lane-world.ts'

// world > repo r > module m of two 2-unit files with a 1-unit street between
// them, at x 4 to 5.
const NODES: RouteNode[] = [
  { id: 'world', kind: 'world', rect: { x: 0, y: 0, w: 12, h: 10 } },
  { id: 'r', parent: 'world', kind: 'repo', rect: { x: 0, y: 0, w: 12, h: 10 } },
  { id: 'r/m', parent: 'r', kind: 'module', rect: { x: 1, y: 2, w: 7, h: 4 } },
  { id: 'r/m/a.ts', parent: 'r/m', kind: 'file', rect: { x: 2, y: 3, w: 2, h: 2 } },
  { id: 'r/m/b.ts', parent: 'r/m', kind: 'file', rect: { x: 5, y: 3, w: 2, h: 2 } },
]

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

function rectOf(nodes: readonly RouteNode[], id: string): Rect {
  return nodes.find((node) => node.id === id)?.rect as Rect
}

function isOnBorder(rect: Rect, x: number, y: number): boolean {
  const onX = (x === rect.x || x === rect.x + rect.w) && y >= rect.y && y <= rect.y + rect.h
  const onY = (y === rect.y || y === rect.y + rect.h) && x >= rect.x && x <= rect.x + rect.w
  return onX || onY
}

function isInside(rect: Rect, x: number, y: number): boolean {
  return x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h
}

describe('LaneWorld', () => {
  it('routes between two files of a module in the street between them, in grid units', () => {
    const world = new LaneWorld(NODES, [['r/m/a.ts', 'r/m/b.ts']])
    const { links, routes, edgeOffsets, edges } = world.routeFiles()
    expect(links).toEqual([{ from: 'r/m/a.ts', to: 'r/m/b.ts' }])
    expect(routes.pitch).toBe(FILE_LANE_PITCH)
    expect([...edges.subarray(edgeOffsets[0], edgeOffsets[1])]).toEqual([0])
    // From a's right side, along the middle of the street, to b's left side.
    const points = listPoints(routes, 0)
    expect(points.slice(0, 2)).toEqual([4, 4])
    expect(points.at(-2)).toBe(5)
    expect(points.filter((_, k) => k % 2 === 0 && k > 0 && k < points.length - 2)).toEqual([
      4.5, 4.5,
    ])
  })

  it('draws one line per importing and imported file, carrying every import between them', () => {
    const edges: LaneEdge[] = [
      ['r/m/a.ts', 'r/m/b.ts'],
      ['r/m/a.ts#run', 'r/m/b.ts#helper'],
      ['r/m/b.ts', 'r/m/a.ts'],
    ]
    const { links, edgeOffsets, edges: carried } = new LaneWorld(NODES, edges).routeFiles()
    expect(links).toEqual([
      { from: 'r/m/a.ts', to: 'r/m/b.ts' },
      { from: 'r/m/b.ts', to: 'r/m/a.ts' },
    ])
    expect([...carried.subarray(edgeOffsets[0], edgeOffsets[1])]).toEqual([0, 1])
    expect([...carried.subarray(edgeOffsets[1], edgeOffsets[2])]).toEqual([2])
  })

  it('ends every line on a file, never on a folder', () => {
    const edges: LaneEdge[] = [
      ['r/src/core/c2.ts', 'r/src/util/u2.ts'],
      ['r/src/core/c1.ts', 'r/src/util/u2.ts'],
      ['r/src/main.ts', 'r/src/core/c3.ts'],
      ['r/src/util/u1.ts', 'r/src/main.ts'],
      ['r/src/util/u1.ts', 'r/src/util/u3.ts'],
    ]
    const { links, routes } = new LaneWorld(FOLDER, edges).routeFiles()
    expect(links).toHaveLength(edges.length)
    links.forEach(({ from, to }, i) => {
      const points = listPoints(routes, i)
      expect(points.length, `${from} -> ${to}`).toBeGreaterThan(2)
      const [x0, y0] = points as [number, number]
      const [x1, y1] = points.slice(-2) as [number, number]
      expect(isOnBorder(rectOf(FOLDER, from), x0, y0), from).toBe(true)
      expect(isOnBorder(rectOf(FOLDER, to), x1, y1), to).toBe(true)
    })
  })

  it('crosses into a folder once, straight on, and lands on the file it imports', () => {
    const { routes } = new LaneWorld(FOLDER, [
      ['r/src/core/c2.ts', 'r/src/util/u2.ts'],
    ]).routeFiles()
    const points = listPoints(routes, 0)
    const util = rectOf(FOLDER, 'r/src/util')
    // util's label strip: nothing crosses it.
    const label: Rect = { x: util.x, y: util.y, w: util.w, h: 1 }
    let entries = 0
    for (let k = 0; k + 3 < points.length; k += 2) {
      const [x0, y0, x1, y1] = points.slice(k, k + 4) as [number, number, number, number]
      // Every segment runs along one axis.
      expect(x0 === x1 || y0 === y1).toBe(true)
      const isIn = (x: number, y: number) => isInside(util, x, y) || isOnBorder(util, x, y)
      if (!isIn(x0, y0) && isIn(x1, y1)) {
        entries++
        // Straight across the border, not along it, and below the label.
        expect(isOnBorder(util, x0, y0)).toBe(false)
        expect(isInside(label, x1, y1) || (y0 < util.y && y1 >= util.y)).toBe(false)
      }
    }
    expect(entries).toBe(1)
    const [x, y] = points.slice(-2) as [number, number]
    expect(isOnBorder(rectOf(FOLDER, 'r/src/util/u2.ts'), x, y)).toBe(true)
  })

  it('routes the whole world once and keeps it', () => {
    const world = new LaneWorld(FOLDER, [['r/src/util/u1.ts', 'r/src/util/u3.ts']])
    expect(world.routeFiles()).toBe(world.routeFiles())
  })
})
