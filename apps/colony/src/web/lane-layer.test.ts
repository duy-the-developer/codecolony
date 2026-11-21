import { describe, expect, it } from 'vitest'
import type { Edge, NodeKind, Rect, World, WorldNode } from '../shared/world-types.ts'
import { type LaneFrame, LaneLayer } from './lane-layer.ts'
import { createLaneRouter } from './lane-router.ts'
import type { LaneRoutes } from './lane-world.ts'
import { Scene } from './scene.ts'

function node(id: string, kind: NodeKind, parent: string | undefined, rect: Rect): WorldNode {
  const base = { id, kind, name: id, lines: 1, complexity: 0, rect }
  return parent === undefined ? base : { ...base, parent }
}

function importEdge(from: string, to: string): Edge {
  return { from, to, kind: 'import', provenance: 'tree-sitter' }
}

// world > repo > three modules, a and b in the first row and c below,
// 4 units apart, one file each: a imports b and c, b imports c.
function makeScene(): Scene {
  const nodes = [
    node('world', 'world', undefined, { x: 0, y: 0, w: 26, h: 27 }),
    node('r', 'repo', 'world', { x: 0, y: 0, w: 26, h: 27 }),
  ]
  for (const [name, x, y] of [
    ['a', 1, 2],
    ['b', 15, 2],
    ['c', 1, 16],
  ] as const) {
    nodes.push(node(`r/${name}`, 'module', 'r', { x, y, w: 10, h: 10 }))
    nodes.push(node(`r/${name}/f.ts`, 'file', `r/${name}`, { x: x + 1, y: y + 1, w: 2, h: 2 }))
  }
  const edges = [
    importEdge('r/a/f.ts', 'r/b/f.ts'),
    importEdge('r/a/f.ts', 'r/c/f.ts'),
    importEdge('r/b/f.ts', 'r/c/f.ts'),
  ]
  return new Scene({ version: 1, indexedAt: '', languages: {}, nodes, edges } satisfies World)
}

interface Lane {
  points: Float64Array
  emphasis: 'normal' | 'hot' | 'dim'
}

// The lanes a frame draws, as the renderer reads them.
function listLanes(frame: LaneFrame): Lane[] {
  const lanes: Lane[] = []
  const add = (routes: LaneRoutes, emphasisOf: (link: number) => Lane['emphasis']) => {
    routes.links.forEach((link, i) => {
      const points = routes.points.subarray(routes.offsets[i], routes.offsets[i + 1])
      if (points.length > 0) lanes.push({ points, emphasis: emphasisOf(link) })
    })
  }
  const { all, hot, focus } = frame
  if (all) add(all, (link) => (hot ? (hot[link] ? 'hot' : 'dim') : 'normal'))
  if (focus) add(focus, () => 'hot')
  return lanes
}

// Draws frames until the routes asked for have arrived.
async function settle(draw: () => LaneFrame): Promise<LaneFrame> {
  let frame = draw()
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    frame = draw()
  }
  return frame
}

const SCALE = 40
const NOTHING = new Set<string>()

describe('LaneLayer', () => {
  it('draws no lanes with the overlay off and nothing in focus', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const frame = await settle(() => layer.frame(SCALE, [], undefined, NOTHING, false))
    expect(listLanes(frame)).toEqual([])
  })

  it('draws only the focus links when the overlay is off', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const focus = new Set(['r/a', 'r/a/f.ts'])
    const frame = await settle(() => layer.frame(SCALE, [], 'r/a', focus, false))
    expect(listLanes(frame)).toHaveLength(2)
    expect(listLanes(frame).every((lane) => lane.emphasis === 'hot')).toBe(true)
  })

  it('draws every link with the overlay on, and highlights the focus links', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const all = await settle(() => layer.frame(SCALE, [], undefined, NOTHING, true))
    expect(listLanes(all).map((lane) => lane.emphasis)).toEqual(['normal', 'normal', 'normal'])
    const focus = new Set(['r/c', 'r/c/f.ts'])
    const focused = await settle(() => layer.frame(SCALE, [], 'r/c', focus, true))
    expect(
      listLanes(focused)
        .map((lane) => lane.emphasis)
        .sort(),
    ).toEqual(['dim', 'hot', 'hot'])
  })

  it('keeps every link undimmed when the focus has no link in or out', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const focus = new Set(['r', 'r/a', 'r/a/f.ts', 'r/b', 'r/b/f.ts', 'r/c', 'r/c/f.ts'])
    const frame = await settle(() => layer.frame(SCALE, [], 'r', focus, true))
    expect(listLanes(frame).map((lane) => lane.emphasis)).toEqual(['normal', 'normal', 'normal'])
  })

  it('ends each lane with an arrow into the imported block', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    // Both of c's links import c, which spans x 1-11, y 16-26.
    const focus = new Set(['r/c', 'r/c/f.ts'])
    const frame = await settle(() => layer.frame(SCALE, [], 'r/c', focus, false))
    expect(listLanes(frame)).toHaveLength(2)
    for (const { points: p } of listLanes(frame)) {
      const [x, y] = [p[p.length - 2] as number, p[p.length - 1] as number]
      const onSide = (x === 1 || x === 11) && y > 16 && y < 26
      const onTopOrBottom = (y === 16 || y === 26) && x > 1 && x < 11
      expect(onSide || onTopOrBottom).toBe(true)
    }
  })
})
