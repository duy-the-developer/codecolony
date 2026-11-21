import { describe, expect, it } from 'vitest'
import type { Edge, NodeKind, Rect, World, WorldNode } from '../shared/world-types.ts'
import { MIN_VISIBLE_PX, openness } from './lod.ts'
import {
  MIN_ROAD_ALPHA,
  PROVEN_PROVENANCES,
  ROAD_LEVELS_PER_OCTAVE,
  RoadCache,
} from './road-cache.ts'
import { Scene } from './scene.ts'

function node(id: string, kind: NodeKind, parent: string | undefined, rect: Rect): WorldNode {
  const base = { id, kind, name: id, lines: 1, complexity: 0, rect }
  return parent === undefined ? base : { ...base, parent }
}

function edge(from: string, to: string, kind: Edge['kind'] = 'import'): Edge {
  return { from, to, kind, provenance: 'tree-sitter' }
}

// world > repo > two modules of two files, each file with two symbols.
function makeWorld(edges: Edge[]): World {
  const nodes = [
    node('world', 'world', undefined, { x: 0, y: 0, w: 200, h: 200 }),
    node('r', 'repo', 'world', { x: 0, y: 0, w: 200, h: 200 }),
  ]
  for (const [d, dx] of [
    ['r/a', 0],
    ['r/b', 50],
  ] as const) {
    nodes.push(node(d, 'module', 'r', { x: dx, y: 0, w: 50, h: 50 }))
    for (const [f, fy] of [
      [`${d}/1.ts`, 0],
      [`${d}/2.ts`, 25],
    ] as const) {
      nodes.push(node(f, 'file', d, { x: dx, y: fy, w: 25, h: 25 }))
      for (const [s, sy] of [
        ['x', 0],
        ['y', 12],
      ] as const) {
        nodes.push({
          ...node(`${f}#${s}`, 'symbol', f, { x: dx, y: fy + sy, w: 25, h: 12 }),
          symbolKind: 'function',
        })
      }
    }
  }
  return { version: 1, indexedAt: '', languages: {}, nodes, edges }
}

// The world-space window the camera shows.
const WHOLE_WORLD: Rect = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }

// The nodes the renderer draws with enough alpha to hold a road.
function listHolders(scene: Scene, scale: number, window: Rect): WorldNode[] {
  const holders: WorldNode[] = []
  const visit = (n: WorldNode, alpha: number) => {
    const { x, y, w, h } = n.rect
    if (x > window.x + window.w || y > window.y + window.h) return
    if (x + w < window.x || y + h < window.y) return
    const side = Math.min(w, h) * scale
    if (n.kind !== 'world' && side < MIN_VISIBLE_PX) return
    const kids = scene.children.get(n.id)
    const open = kids ? openness(n.kind, side) : 0
    if (n.kind !== 'world' && alpha >= MIN_ROAD_ALPHA) holders.push(n)
    if (open > 0.01 && kids) for (const kid of kids) visit(kid, alpha * open)
  }
  if (scene.root) visit(scene.root, 1)
  return holders
}

// The per-frame aggregation the renderer did before the cache: each edge goes
// to the deepest holder of each end.
function listRoadsPerFrame(scene: Scene, holders: WorldNode[]): string[] {
  const held = new Set(holders.map((n) => n.id))
  const holder = (id: string) => {
    for (let n = scene.byId.get(id); n; n = scene.parentOf(n)) if (held.has(n.id)) return n.id
    return undefined
  }
  const roads = new Map<string, number>()
  for (const e of scene.edges) {
    const from = holder(e.from)
    const to = holder(e.to)
    if (!from || !to || from === to) continue
    if (scene.isAncestor(from, to) || scene.isAncestor(to, from)) continue
    const key = `${e.kind}|${from}|${to}|${PROVEN_PROVENANCES.has(e.provenance)}`
    roads.set(key, (roads.get(key) ?? 0) + 1)
  }
  return [...roads].map(([key, count]) => `${key}|${count}`)
}

function listRoads(
  cache: RoadCache,
  scene: Scene,
  scale: number,
  window = WHOLE_WORLD,
  subtree: ReadonlySet<string> = new Set(),
): string[] {
  const holders = listHolders(scene, scale, window).map((node) => ({ node }))
  const roads = cache.listRoads(scale, holders, subtree)
  const out: string[] = []
  for (let r = 0; r < roads.count; r++) {
    const from = holders[roads.from[r] as number]?.node.id
    const to = holders[roads.to[r] as number]?.node.id
    const hot = roads.hot[r] ? '|hot' : ''
    out.push(`${roads.kind[r]}|${from}|${to}|${roads.proven[r] === 1}|${roads.edges[r]}${hot}`)
  }
  return out
}

const EDGES = [
  edge('r/a/1.ts#x', 'r/b/1.ts#x'),
  edge('r/a/1.ts#y', 'r/b/2.ts#y'),
  edge('r/a/2.ts#x', 'r/b/1.ts#y', 'call'),
  { ...edge('r/a/2.ts#x', 'r/b/1.ts#y', 'call'), provenance: 'inferred' },
  edge('r/a/1.ts#x', 'r/a/2.ts#y'),
  edge('r/a/1.ts#x', 'r/a/1.ts#y', 'call'),
  edge('r/b/2.ts#x', 'r/b/2.ts'),
  edge('r/b/2.ts#x', 'missing'),
] satisfies Edge[]

describe('RoadCache', () => {
  it('merges roads into the holders visible when zoomed out', () => {
    const scene = new Scene(makeWorld(EDGES))
    // Modules are 50 units: at scale 0.3 they are 15 px, so the repo is open
    // but the modules are still closed.
    expect(listRoads(new RoadCache(scene), scene, 0.3)).toEqual([
      'import|r/a|r/b|true|2',
      'call|r/a|r/b|true|1',
      'call|r/a|r/b|false|1',
    ])
  })

  it('splits roads down to symbols when zoomed in', () => {
    const scene = new Scene(makeWorld(EDGES))
    const roads = listRoads(new RoadCache(scene), scene, 40)
    expect(roads).toContain('call|r/a/1.ts#x|r/a/1.ts#y|true|1')
    expect(roads).toContain('import|r/a/1.ts#x|r/b/1.ts#x|true|1')
  })

  it('moves ends that are off screen up to their ancestor on screen', () => {
    const scene = new Scene(makeWorld(EDGES))
    // Only r/a/1.ts is on screen, so edges to r/a/2.ts and r/b end on an
    // ancestor of the other end and are dropped.
    const window = { x: 1, y: 1, w: 20, h: 20 }
    expect(listRoads(new RoadCache(scene), scene, 40, window)).toEqual([
      'call|r/a/1.ts#x|r/a/1.ts#y|true|1',
    ])
  })

  it('matches the per-frame aggregation at every scale and window', () => {
    const scene = new Scene(makeWorld(EDGES))
    const cache = new RoadCache(scene)
    const windows = [
      WHOLE_WORLD,
      { x: 1, y: 1, w: 20, h: 10 },
      { x: 1, y: 1, w: 20, h: 20 },
      { x: 30, y: 20, w: 40, h: 10 },
      { x: 60, y: 30, w: 30, h: 15 },
    ]
    // Level boundaries, and points between them.
    for (let step = -32; step <= 160; step++) {
      const scale = 2 ** (step / (3 * ROAD_LEVELS_PER_OCTAVE))
      for (const window of windows) {
        expect(listRoads(cache, scene, scale, window).sort(), `scale ${scale}`).toEqual(
          listRoadsPerFrame(scene, listHolders(scene, scale, window)).sort(),
        )
      }
    }
  })

  it('rebuilds after edges are merged in', () => {
    const scene = new Scene(makeWorld(EDGES))
    const cache = new RoadCache(scene)
    expect(listRoads(cache, scene, 0.3)).not.toContain('call|r/b|r/a|true|1')
    scene.mergeEdges([{ ...edge('r/b/1.ts#x', 'r/a/1.ts#x', 'call'), provenance: 'lsp' }])
    expect(listRoads(cache, scene, 0.3)).toContain('call|r/b|r/a|true|1')
  })

  it('marks the roads that carry an edge touching the selection', () => {
    const scene = new Scene(makeWorld(EDGES))
    const cache = new RoadCache(scene)
    expect(listRoads(cache, scene, 0.3, WHOLE_WORLD, new Set(['r/b/2.ts', 'r/b/2.ts#y']))).toEqual([
      'import|r/a|r/b|true|2|hot',
      'call|r/a|r/b|true|1',
      'call|r/a|r/b|false|1',
    ])
  })

  it('flags roads between symbols of one file', () => {
    const scene = new Scene(makeWorld(EDGES))
    const cache = new RoadCache(scene)
    const holders = listHolders(scene, 40, WHOLE_WORLD).map((node) => ({ node }))
    const roads = cache.listRoads(40, holders, new Set())
    const same: string[] = []
    for (let r = 0; r < roads.count; r++) {
      if (roads.sameFile[r]) same.push(`${holders[roads.from[r] as number]?.node.id}`)
    }
    expect(same).toEqual(['r/a/1.ts#x'])
  })
})
