import { describe, expect, it } from 'vitest'
import { symbolBand } from '../layout/symbol-band.ts'
import type { Edge, World, WorldNode, WorldResponse } from '../world/world-types.ts'
import { symbolsFromRows, worldFromResponse } from './world-decoder.ts'
import { createWorldEncoder, WorldEncodeError } from './world-encoder.ts'

// A small laid-out world with what the wire format has to carry: nested
// symbols, a package, transports, every edge shape, an edge to an id outside
// the map and evidence in a file outside it.

const ROOT = 'project:demo/app'

function symbol(
  file: WorldNode,
  qualified: string,
  name: string,
  range: { start: number; end: number },
  holder?: WorldNode,
): WorldNode {
  return {
    id: `${file.id}#${qualified}`,
    parent: holder?.id ?? file.id,
    kind: 'symbol',
    name,
    path: file.path as string,
    lines: range.end - range.start + 1,
    complexity: 1,
    rect: symbolBand(range, file.rect, file.lines, holder?.rect),
    symbolKind: holder ? 'method' : 'class',
    range,
    exported: !holder,
  }
}

function makeWorld(version = 1): World {
  const world: WorldNode = {
    id: 'world',
    kind: 'world',
    name: 'world',
    lines: 60,
    complexity: 6,
    rect: { x: 0, y: 0, w: 40, h: 30 },
  }
  const project: WorldNode = {
    id: 'project:demo',
    parent: 'world',
    kind: 'project',
    name: 'demo',
    lines: 60,
    complexity: 6,
    rect: { x: 1, y: 1, w: 38, h: 28 },
  }
  const repo: WorldNode = {
    id: ROOT,
    parent: project.id,
    kind: 'repo',
    name: 'app',
    lines: 60,
    complexity: 6,
    rect: { x: 2, y: 3, w: 36, h: 25 },
    commit: 'abc1234',
    package: true,
  }
  const pkg: WorldNode = {
    id: `${ROOT}/package:packages/core`,
    parent: ROOT,
    kind: 'package',
    name: 'packages/core',
    path: 'packages/core',
    lines: 20,
    complexity: 2,
    rect: { x: 20, y: 5, w: 16, h: 12 },
    package: true,
  }
  const module: WorldNode = {
    id: `${ROOT}/src/web`,
    parent: ROOT,
    kind: 'module',
    name: 'src/web',
    path: 'src/web',
    lines: 40,
    complexity: 4,
    rect: { x: 3, y: 5, w: 16, h: 20 },
  }
  const a: WorldNode = {
    id: `${ROOT}/src/web/a.ts`,
    parent: module.id,
    kind: 'file',
    name: 'a.ts',
    path: 'src/web/a.ts',
    lines: 30,
    complexity: 3,
    rect: { x: 4, y: 7, w: 6, h: 6 },
    language: 'typescript',
    transports: [
      {
        kind: 'http-client',
        target: '/api/x',
        method: 'GET',
        line: 3,
        detector: 'fetch',
        provenance: 'text',
      },
    ],
  }
  const b: WorldNode = {
    id: `${ROOT}/src/web/b.ts`,
    parent: module.id,
    kind: 'file',
    name: 'b.ts',
    path: 'src/web/b.ts',
    lines: 10,
    complexity: 1,
    rect: { x: 11, y: 7, w: 4, h: 4 },
    language: 'typescript',
  }
  const core: WorldNode = {
    id: `${ROOT}/packages/core/index.ts`,
    parent: pkg.id,
    kind: 'file',
    name: 'index.ts',
    path: 'packages/core/index.ts',
    lines: 20,
    complexity: 2,
    rect: { x: 21, y: 7, w: 5, h: 5 },
    language: 'typescript',
  }
  const readme: WorldNode = {
    id: `${ROOT}/README.md`,
    parent: ROOT,
    kind: 'file',
    name: 'README.md',
    path: 'README.md',
    lines: 5,
    complexity: 0,
    rect: { x: 30, y: 20, w: 3, h: 3 },
    language: 'text',
  }
  const shape = symbol(a, 'Shape', 'Shape', { start: 1, end: 20 })
  const area = symbol(a, 'Shape.area', 'area', { start: 4, end: 9 }, shape)
  const draw = symbol(b, 'draw', 'draw', { start: 2, end: 8 })
  const edges: Edge[] = [
    {
      from: a.id,
      to: b.id,
      kind: 'import',
      provenance: 'tree-sitter',
      label: './b.ts',
      at: { file: a.id, line: 1 },
      typeOnly: false,
    },
    {
      from: area.id,
      to: draw.id,
      kind: 'call',
      provenance: 'tree-sitter',
      label: 'draw',
      at: { file: a.id, line: 5 },
    },
    {
      from: a.id,
      to: core.id,
      kind: 'http',
      provenance: 'text',
      label: 'GET /api/x',
      at: { file: a.id, line: 3 },
    },
    {
      from: b.id,
      to: `${ROOT}/gone.ts#lost`,
      kind: 'call',
      provenance: 'inferred',
      at: { file: 'elsewhere.ts', line: 9 },
    },
    { from: draw.id, to: shape.id, kind: 'import', provenance: 'lsp', typeOnly: true },
  ]
  return {
    version,
    indexedAt: '2026-11-21T00:00:00.000Z',
    languages: { typescript: { semantic: true } },
    nodes: [world, project, repo, pkg, module, a, shape, area, b, draw, core, readme],
    edges,
  }
}

function decode(body: string, base?: Parameters<typeof worldFromResponse>[1]) {
  return worldFromResponse(JSON.parse(body) as WorldResponse, base)
}

const withoutSymbols = (world: World) => world.nodes.filter((node) => node.kind !== 'symbol')

describe('createWorldEncoder', () => {
  it('sends the world without symbols and decodes it exactly', () => {
    const world = makeWorld()
    const state = decode(createWorldEncoder().encodeWorld(world))
    expect(state.world.nodes).toEqual(withoutSymbols(world))
    expect(state.world.edges).toEqual(world.edges)
    expect(state.world.version).toBe(1)
  })

  it('sends a file its symbols with the rectangles the layout gave them', () => {
    const world = makeWorld()
    const encoder = createWorldEncoder()
    const state = decode(encoder.encodeWorld(world))
    const files = state.world.nodes.flatMap((node, i) => (node.kind === 'file' ? [i] : []))
    const response = encoder.encodeSymbols(world, { session: state.session, version: 1 }, files)
    const symbols = Object.entries(response?.files ?? {}).flatMap(([index, rows]) =>
      symbolsFromRows(state.world.nodes[Number(index)] as WorldNode, rows),
    )
    expect(symbols).toEqual(world.nodes.filter((node) => node.kind === 'symbol'))
  })

  it('refuses symbols for a stale version or another session', () => {
    const encoder = createWorldEncoder({ session: 's' })
    const world = makeWorld(2)
    expect(encoder.encodeSymbols(world, { session: 's', version: 1 }, [5])).toBeUndefined()
    expect(encoder.encodeSymbols(world, { session: 'other', version: 2 }, [5])).toBeUndefined()
    expect(encoder.encodeSymbols(world, { session: 's', version: 2 }, [5])?.files).toHaveProperty(
      '5',
    )
  })

  it('refuses a world that puts a node before its parent', () => {
    const world = makeWorld()
    const [root, project, repo, ...rest] = world.nodes
    world.nodes = [root, repo, project, ...rest] as WorldNode[]
    expect(() => createWorldEncoder().encodeWorld(world)).toThrow(WorldEncodeError)
  })

  it('patches the version before into the same world a fresh load gives', () => {
    const encoder = createWorldEncoder()
    const before = makeWorld(1)
    const base = decode(encoder.encodeWorld(before))
    const after = makeWorld(2)
    const b = after.nodes.find((node) => node.name === 'b.ts') as WorldNode
    b.lines = 12
    b.rect = { ...b.rect, w: 5 }
    after.nodes.push({ ...b, id: `${b.parent}/c.ts`, name: 'c.ts', path: 'src/web/c.ts' })
    after.edges = after.edges.slice(1)
    after.edges.push({ from: b.id, to: `${b.parent}/c.ts`, kind: 'import', provenance: 'lsp' })

    const body = encoder.encodeWorld(after, { session: base.session, version: 1 })
    expect((JSON.parse(body) as WorldResponse).type).toBe('patch')
    const patched = decode(body, base)
    const fresh = decode(createWorldEncoder().encodeWorld(after))
    expect(patched.world).toEqual(fresh.world)
    expect(patched.world.nodes).toEqual(withoutSymbols(after))
  })

  it('sends the whole world to a page from another session or an older version', () => {
    const encoder = createWorldEncoder({ session: 's1' })
    encoder.encodeWorld(makeWorld(1))
    encoder.encodeWorld(makeWorld(2))
    const type = (body: string) => (JSON.parse(body) as WorldResponse).type
    expect(type(encoder.encodeWorld(makeWorld(3), { session: 's1', version: 1 }))).toBe('full')
    expect(type(encoder.encodeWorld(makeWorld(4), { session: 'other', version: 3 }))).toBe('full')
    expect(type(encoder.encodeWorld(makeWorld(5), { session: 's1', version: 4 }))).toBe('patch')
  })

  it('sends the whole world when the patch would be too big', () => {
    const encoder = createWorldEncoder({ maxEdits: 0 })
    const base = decode(encoder.encodeWorld(makeWorld(1)))
    const after = makeWorld(2)
    after.edges = []
    const body = encoder.encodeWorld(after, { session: base.session, version: 1 })
    expect((JSON.parse(body) as WorldResponse).type).toBe('full')
  })
})

describe('worldFromResponse', () => {
  it('refuses a patch for a version the page does not hold', () => {
    const encoder = createWorldEncoder()
    const base = decode(encoder.encodeWorld(makeWorld(1)))
    const patch = encoder.encodeWorld(makeWorld(2), { session: base.session, version: 1 })
    expect(() => decode(patch, { ...base, world: { ...base.world, version: 7 } })).toThrow(
      expect.objectContaining({ code: 'StaleBase' }),
    )
  })
})
