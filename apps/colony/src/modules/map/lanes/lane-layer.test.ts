import { describe, expect, it } from 'vitest'
import { Scene } from '../../scene/scene.ts'
import type { Edge, NodeKind, Rect, World, WorldNode } from '../../world/world-types.ts'
import { buildFocus, DEPENDANT, DEPENDS_ON, NO_FOCUS } from '../focus.ts'
import { MIN_LINK_ALPHA } from '../link-cache.ts'
import { MIN_VISIBLE_PX, openness } from '../lod.ts'
import { type LaneFrame, LaneLayer } from './lane-layer.ts'
import { createLaneRouter } from './lane-router.ts'
import type { LaneRoutes } from './lane-world.ts'

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
  const { all, hot, focus, focusHot } = frame
  if (all) add(all, (link) => (hot ? (hot[link] ? 'hot' : 'dim') : 'normal'))
  if (focus) {
    focus.links.forEach((link, i) => {
      const points = focus.points.subarray(focus.offsets[i], focus.offsets[i + 1])
      if (focusHot?.[link] && points.length > 0) lanes.push({ points, emphasis: 'hot' })
    })
  }
  return lanes
}

// Draws frames until the routes asked for have arrived.
async function settle(draw: () => LaneFrame): Promise<LaneFrame> {
  let frame = draw()
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    frame = draw()
  }
  return frame
}

const SCALE = 40

// world > two repositories side by side, each with one module: r1/a's two
// files import r2/b's one.
function makeTwoRepos(): Scene {
  const nodes = [
    node('world', 'world', undefined, { x: 0, y: 0, w: 46, h: 20 }),
    node('r1', 'repo', 'world', { x: 0, y: 0, w: 20, h: 20 }),
    node('r1/a', 'module', 'r1', { x: 1, y: 3, w: 10, h: 10 }),
    node('r1/a/f.ts', 'file', 'r1/a', { x: 2, y: 5, w: 2, h: 2 }),
    node('r1/a/f2.ts', 'file', 'r1/a', { x: 5, y: 5, w: 2, h: 2 }),
    node('r2', 'repo', 'world', { x: 26, y: 0, w: 20, h: 20 }),
    node('r2/b', 'module', 'r2', { x: 27, y: 3, w: 10, h: 10 }),
    node('r2/b/g.ts', 'file', 'r2/b', { x: 28, y: 5, w: 2, h: 2 }),
  ]
  const edges = [importEdge('r1/a/f.ts', 'r2/b/g.ts'), importEdge('r1/a/f2.ts', 'r2/b/g.ts')]
  return new Scene({ version: 1, indexedAt: '', languages: {}, nodes, edges } satisfies World)
}

// The nodes the renderer draws with enough alpha to hold a link, with the
// camera showing `window` of the world.
function listHolders(scene: Scene, scale: number, window: Rect): { node: WorldNode }[] {
  const holders: { node: WorldNode }[] = []
  const visit = (n: WorldNode, alpha: number) => {
    const { x, y, w, h } = n.rect
    if (x > window.x + window.w || y > window.y + window.h) return
    if (x + w < window.x || y + h < window.y) return
    const side = Math.min(w, h) * scale
    if (n.kind !== 'world' && side < MIN_VISIBLE_PX) return
    const kids = scene.children.get(n.id)
    const open = kids ? openness(n.kind, side) : 0
    if (n.kind !== 'world' && alpha >= MIN_LINK_ALPHA) holders.push({ node: n })
    if (open > 0.01 && kids) for (const kid of kids) visit(kid, alpha * open)
  }
  if (scene.root) visit(scene.root, 1)
  return holders
}

describe('LaneLayer', () => {
  it('draws no lanes with the overlay off and nothing in focus', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const frame = await settle(() => layer.frame(SCALE, [], NO_FOCUS, false))
    expect(listLanes(frame)).toEqual([])
  })

  it('draws only the focus links when the overlay is off', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const frame = await settle(() => layer.frame(SCALE, [], buildFocus(scene, ['r/a']), false))
    expect(listLanes(frame)).toHaveLength(2)
    expect(listLanes(frame).every((lane) => lane.emphasis === 'hot')).toBe(true)
  })

  it('draws every link with the overlay on, and highlights the focus links', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const all = await settle(() => layer.frame(SCALE, [], NO_FOCUS, true))
    expect(listLanes(all).map((lane) => lane.emphasis)).toEqual(['normal', 'normal', 'normal'])
    const focused = await settle(() => layer.frame(SCALE, [], buildFocus(scene, ['r/c']), true))
    expect(
      listLanes(focused)
        .map((lane) => lane.emphasis)
        .sort(),
    ).toEqual(['dim', 'hot', 'hot'])
  })

  it('keeps every link undimmed when the focus has no link in or out', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const frame = await settle(() => layer.frame(SCALE, [], buildFocus(scene, ['r']), true))
    expect(listLanes(frame).map((lane) => lane.emphasis)).toEqual(['normal', 'normal', 'normal'])
  })

  it('draws the links of every selected node, including those between them', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    // a and b: a's two links, and b's link to c; a to b is between them.
    const frame = await settle(() =>
      layer.frame(SCALE, [], buildFocus(scene, ['r/a', 'r/b']), false),
    )
    expect(listLanes(frame)).toHaveLength(3)
    expect(listLanes(frame).every((lane) => lane.emphasis === 'hot')).toBe(true)
  })

  it('tells the links the focus depends on from those of its dependants', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    // b imports c and is imported by a.
    const focus = buildFocus(scene, ['r/b'])
    const off = await settle(() => layer.frame(SCALE, [], focus, false))
    const on = await settle(() => layer.frame(SCALE, [], focus, true))
    for (const [routes, hot] of [
      [off.focus, off.focusHot],
      [on.all, on.hot],
    ] as const) {
      const directions = [...(routes?.links ?? [])].map((link) => hot?.[link] ?? 0)
      expect(directions.filter((d) => d !== 0).sort()).toEqual([DEPENDS_ON, DEPENDANT])
    }
  })

  it('marks each drawn partner by the way its imports run', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const holders = scene.world.nodes.filter((n) => n.kind === 'module').map((node) => ({ node }))
    const frame = await settle(() => layer.frame(SCALE, holders, buildFocus(scene, ['r/b']), false))
    expect(frame.partners).toEqual(
      new Map([
        ['r/a', DEPENDANT],
        ['r/c', DEPENDS_ON],
      ]),
    )
  })

  it('ends each line with an arrow on the file it imports', async () => {
    const scene = makeScene()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    // Both of c's lines import c/f.ts, which spans x 2-4, y 17-19.
    const frame = await settle(() => layer.frame(SCALE, [], buildFocus(scene, ['r/c']), false))
    expect(listLanes(frame)).toHaveLength(2)
    for (const { points: p } of listLanes(frame)) {
      const [x, y] = [p[p.length - 2] as number, p[p.length - 1] as number]
      const onSide = (x === 2 || x === 4) && y >= 17 && y <= 19
      const onTopOrBottom = (y === 17 || y === 19) && x >= 2 && x <= 4
      expect(onSide || onTopOrBottom).toBe(true)
    }
  })

  it('never moves a line as the map pans', async () => {
    const scene = makeTwoRepos()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const scale = 16
    const windows: Rect[] = [
      { x: 0, y: 0, w: 46, h: 20 },
      { x: 0, y: 0, w: 12, h: 12 },
      { x: 26, y: 0, w: 12, h: 12 },
      { x: 10, y: 0, w: 20, h: 8 },
    ]
    const frames: LaneFrame[] = []
    for (const window of windows) {
      const holders = listHolders(scene, scale, window)
      frames.push(await settle(() => layer.frame(scale, holders, NO_FOCUS, true)))
    }
    const [whole, ...panned] = frames as [LaneFrame, ...LaneFrame[]]
    // One line per importing file, both into r2/b/g.ts.
    expect(listLanes(whole)).toHaveLength(2)
    for (const frame of panned) {
      expect(frame.all).toBe(whole.all)
      expect([...(frame.fade?.alpha ?? [])]).toEqual([...(whole.fade?.alpha ?? [])])
    }
  })

  it('keeps every line the same at every zoom step', async () => {
    const scene = makeTwoRepos()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const window: Rect = { x: 0, y: 0, w: 46, h: 20 }
    const drawnAt = async (scale: number) => {
      const holders = listHolders(scene, scale, window)
      return listLanes(await settle(() => layer.frame(scale, holders, NO_FOCUS, true)))
    }
    const first = (await drawnAt(2 ** (2 / 4))).map((lane) => [...lane.points])
    expect(first).toHaveLength(2)
    for (let step = 3; step <= 20; step++) {
      expect((await drawnAt(2 ** (step / 4))).map((lane) => [...lane.points])).toEqual(first)
    }
  })

  it('fades each line with its files as their modules close', async () => {
    const scene = makeTwoRepos()
    const layer = new LaneLayer(scene, createLaneRouter(), () => {})
    const fadeAt = async (scale: number) => {
      const frame = await settle(() => layer.frame(scale, [], NO_FOCUS, true))
      const fade = frame.fade
      return [...(frame.all?.links ?? [])].map((link) => fade?.alpha[fade.groups[link] as number])
    }
    // The repositories are 20 units: closed under 40 px, open over 90 px.
    expect(await fadeAt(1)).toEqual([0, 0])
    const half = await fadeAt(3)
    for (const alpha of half) expect(alpha).toBeGreaterThan(0)
    for (const alpha of half) expect(alpha).toBeLessThan(1)
    expect(await fadeAt(SCALE)).toEqual([1, 1])
  })
})
