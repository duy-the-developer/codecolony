import { describe, expect, it, vi } from 'vitest'
import { worldFromResponse } from '../shared/world-decoder.ts'
import { createWorldEncoder } from '../shared/world-encoder.ts'
import type { Edge, World, WorldNode, WorldResponse } from '../shared/world-types.ts'
import { describeEdgeRow, listEdgeSections } from './edge-sections.ts'
import { Scene } from './scene.ts'

const RECT = { x: 0, y: 0, w: 8, h: 8 }

function node(id: string, kind: WorldNode['kind'], parent?: string): WorldNode {
  const name = kind === 'symbol' ? (id.split(/[#.]/).at(-1) as string) : id.slice(2)
  const made: WorldNode = { id, kind, name, lines: 20, complexity: 0, rect: RECT }
  if (parent) made.parent = parent
  if (kind === 'symbol') made.range = { start: 2, end: 6 }
  return made
}

// world > r > a.ts (class A with method run) and b.ts (function go).
function makeWorld(version: number, edges: Edge[]): World {
  return {
    version,
    indexedAt: '',
    languages: {},
    nodes: [
      node('world', 'world'),
      node('r', 'repo', 'world'),
      node('r/a.ts', 'file', 'r'),
      node('r/a.ts#A', 'symbol', 'r/a.ts'),
      node('r/a.ts#A.run', 'symbol', 'r/a.ts#A'),
      node('r/b.ts', 'file', 'r'),
      node('r/b.ts#go', 'symbol', 'r/b.ts'),
    ],
    edges,
  }
}

const CALL: Edge = { from: 'r/a.ts#A.run', to: 'r/b.ts#go', kind: 'call', provenance: 'lsp' }

// A scene as the page gets it: the world without symbols, and a fake server.
function makeScene(world: World, previous?: Scene) {
  const encoder = createWorldEncoder({ session: 's' })
  const state = worldFromResponse(JSON.parse(encoder.encodeWorld(world)) as WorldResponse)
  const fetchSymbols = vi.fn((version: number, files: readonly number[]) =>
    Promise.resolve(encoder.encodeSymbols(world, version, files)),
  )
  return { scene: new Scene(state.world, { state, fetchSymbols }, previous), fetchSymbols }
}

describe('Scene', () => {
  it('starts without symbols and loads a file’s symbols once', async () => {
    const { scene, fetchSymbols } = makeScene(makeWorld(1, [CALL]))
    const a = scene.byId.get('r/a.ts') as WorldNode
    expect(scene.byId.has('r/a.ts#A')).toBe(false)
    expect(scene.children.get('r/a.ts')).toEqual([])
    expect(scene.needsSymbols(a)).toBe(true)

    const onChange = vi.fn()
    scene.subscribe(onChange)
    await Promise.all([scene.loadSymbols([a]), scene.loadSymbols([a])])
    expect(fetchSymbols).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(scene.revision).toBe(1)
    expect(scene.needsSymbols(a)).toBe(false)
    expect(scene.listSymbols(a).map((s) => s.id)).toEqual(['r/a.ts#A', 'r/a.ts#A.run'])
    expect(scene.byId.get('r/a.ts#A.run')?.parent).toBe('r/a.ts#A')
  })

  it('counts edges on symbols that are not loaded yet as inside their file', () => {
    const { scene } = makeScene(makeWorld(1, [CALL]))
    const subtree = scene.listSubtree(scene.byId.get('r/a.ts') as WorldNode)
    expect([...subtree].sort()).toEqual(['r/a.ts', 'r/a.ts#A.run'])
    const [section] = listEdgeSections(scene, subtree)
    const row = section?.rows[0]
    expect(row?.other).toBeUndefined()
    if (section && row) expect(describeEdgeRow(scene, row, section.direction)).toBe('go (b.ts)')
  })

  it('loads a symbol’s file to find it by id', async () => {
    const { scene } = makeScene(makeWorld(1, []))
    expect(scene.fileIdOf('r/b.ts#go')).toBe('r/b.ts')
    expect((await scene.ensureNode('r/b.ts#go'))?.name).toBe('go')
    expect(await scene.ensureNode('r/b.ts#nope')).toBeUndefined()
  })

  it('keeps symbols that did not change from the scene it replaces', async () => {
    const first = makeScene(makeWorld(1, []))
    await first.scene.loadSymbols([...first.scene.byId.values()].filter((n) => n.kind === 'file'))
    const changed = makeWorld(2, [])
    const go = changed.nodes.find((n) => n.id === 'r/b.ts#go') as WorldNode
    go.range = { start: 3, end: 9 }
    const { scene, fetchSymbols } = makeScene(changed, first.scene)
    expect(scene.byId.has('r/a.ts#A.run')).toBe(true)
    expect(scene.needsSymbols(scene.byId.get('r/b.ts') as WorldNode)).toBe(true)
    expect(fetchSymbols).not.toHaveBeenCalled()
  })
})
