import { describe, expect, it } from 'vitest'
import { buildChannelGraph, laneCapacity } from '../lane-routing/channel-graph.ts'
import { buildRouteBoxes } from '../lane-routing/route-boxes.ts'
import { countChannelLoad } from '../lane-routing/route-lanes.ts'
import type { Edge, NodeKind, Rect, WorldNode } from '../world/world-types.ts'
import { listBlockLinks } from './lane-widening.ts'
import { emptyLayout, layoutWorld } from './world-layout.ts'

const ZERO = { x: 0, y: 0, w: 0, h: 0 }

function node(id: string, kind: NodeKind, parent?: string, lines = 0): WorldNode {
  const base: WorldNode = { id, kind, name: id, lines, complexity: 0, rect: ZERO }
  if (parent) base.parent = parent
  return base
}

// world > project > repo > two packages; modules hold files of mixed sizes,
// and the repository and one package hold loose files of their own.
function makeNodes(extra: WorldNode[] = []): WorldNode[] {
  const nodes = [
    node('world', 'world'),
    node('p', 'project', 'world'),
    node('p/r', 'repo', 'p'),
    node('p/r/README.md', 'file', 'p/r', 10),
    node('p/r/package.json', 'file', 'p/r', 40),
    node('p/r/package:app', 'package', 'p/r'),
    node('p/r/app/index.ts', 'file', 'p/r/package:app', 100),
    node('p/r/package:lib', 'package', 'p/r'),
  ]
  const modules: [string, string, number][] = [
    ['p/r/app/web', 'p/r/package:app', 9],
    ['p/r/app/server', 'p/r/package:app', 5],
    ['p/r/app/core', 'p/r/package:app', 3],
    ['p/r/app/testing', 'p/r/package:app', 1],
    ['p/r/lib/a', 'p/r/package:lib', 4],
    ['p/r/lib/b', 'p/r/package:lib', 2],
  ]
  for (const [id, pkg, files] of modules) {
    nodes.push(node(id, 'module', pkg))
    for (let i = 0; i < files; i++) {
      const file = node(`${id}/f${i}.ts`, 'file', id, [10, 100, 300, 900][i % 4])
      nodes.push(file)
      nodes.push({
        ...node(`${file.id}#s`, 'symbol', file.id, 5),
        symbolKind: 'function',
        range: { start: 1, end: 5 },
      })
    }
  }
  return [...nodes, ...extra]
}

function importEdge(from: string, to: string): Edge {
  return { from, to, kind: 'import', provenance: 'tree-sitter' }
}

const EDGES = [
  importEdge('p/r/app/index.ts', 'p/r/app/web/f0.ts'),
  importEdge('p/r/app/web/f0.ts', 'p/r/app/server/f0.ts'),
  importEdge('p/r/app/server/f0.ts', 'p/r/app/core/f0.ts'),
  importEdge('p/r/app/web/f1.ts#s', 'p/r/app/core/f1.ts'),
]

function rects(nodes: WorldNode[]): Map<string, Rect> {
  return new Map(nodes.map((n) => [n.id, { ...n.rect }]))
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

function apart(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  )
}

function siblings(nodes: WorldNode[], kind: NodeKind): Map<string, WorldNode[]> {
  const groups = new Map<string, WorldNode[]>()
  for (const n of nodes) {
    if (n.kind !== kind || !n.parent) continue
    groups.set(n.parent, [...(groups.get(n.parent) ?? []), n])
  }
  return groups
}

describe('layoutWorld', () => {
  it('puts every block edge on a grid line, inside its parent', () => {
    const nodes = makeNodes()
    layoutWorld(nodes, EDGES, emptyLayout())
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const n of nodes) {
      if (n.kind === 'symbol') continue
      const { x, y, w, h } = n.rect
      expect([x, y, w, h].every(Number.isInteger), `${n.id} ${JSON.stringify(n.rect)}`).toBe(true)
      expect(w * h, n.id).toBeGreaterThan(0)
      const parent = n.parent ? byId.get(n.parent) : undefined
      if (parent) expect(inside(n.rect, parent.rect), n.id).toBe(true)
    }
  })

  it('sizes files one to four units by line count', () => {
    const nodes = makeNodes()
    layoutWorld(nodes, EDGES, emptyLayout())
    const sides = nodes
      .filter((n) => n.id.startsWith('p/r/app/web/f') && n.kind === 'file')
      .map((n) => [n.lines, n.rect.w, n.rect.h])
    expect(sides).toContainEqual([10, 1, 1])
    expect(sides).toContainEqual([100, 2, 2])
    expect(sides).toContainEqual([300, 3, 3])
    expect(sides).toContainEqual([900, 4, 4])
  })

  it('keeps files a street apart, and modules a gutter apart', () => {
    const nodes = makeNodes()
    layoutWorld(nodes, EDGES, emptyLayout(), { gutter: 3 })
    for (const group of siblings(nodes, 'module').values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i] as WorldNode
          const b = group[j] as WorldNode
          expect(apart(a.rect, b.rect, 3), `${a.id} / ${b.id}`).toBe(true)
        }
      }
    }
    for (const group of siblings(nodes, 'file').values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          expect(apart((group[i] as WorldNode).rect, (group[j] as WorldNode).rect, 1)).toBe(true)
        }
      }
    }
  })

  it('trims the street at the edges of a module, so its files fill it', () => {
    const nodes = makeNodes()
    layoutWorld(nodes, EDGES, emptyLayout())
    for (const [id, files] of siblings(nodes, 'file')) {
      const module = nodes.find((n) => n.id === id) as WorldNode
      if (module.kind !== 'module') continue
      const right = Math.max(...files.map((f) => f.rect.x + f.rect.w))
      const bottom = Math.max(...files.map((f) => f.rect.y + f.rect.h))
      expect(Math.min(...files.map((f) => f.rect.x)), id).toBe(module.rect.x + 1)
      expect(module.rect.y + module.rect.h - bottom, id).toBeGreaterThanOrEqual(1)
      // Narrower modules are as wide as their label needs.
      if (module.rect.w > 4) expect(module.rect.x + module.rect.w - right, id).toBe(1)
    }
  })

  it('packs loose files a gutter apart from the blocks beside them', () => {
    const nodes = makeNodes()
    layoutWorld(nodes, EDGES, emptyLayout(), { gutter: 3 })
    for (const parent of ['p/r', 'p/r/package:app']) {
      const kids = nodes.filter((n) => n.parent === parent)
      const loose = kids.filter((n) => n.kind === 'file')
      const blocks = kids.filter((n) => n.kind !== 'file')
      expect(loose.length, parent).toBeGreaterThan(0)
      for (const file of loose) {
        for (const block of blocks) {
          expect(apart(file.rect, block.rect, 3), `${file.id} / ${block.id}`).toBe(true)
        }
      }
    }
  })

  it('ranks loose files with the blocks they import', () => {
    const nodes = makeNodes()
    layoutWorld(nodes, EDGES, emptyLayout())
    const y = (id: string) => nodes.find((n) => n.id === id)?.rect.y ?? Number.NaN
    expect(y('p/r/app/index.ts')).toBeLessThan(y('p/r/app/core'))
  })

  it('nests subfolder modules inside their folder, beside its own files', () => {
    // lib/b holds files and a subfolder, which holds files and a subfolder of its own.
    const nodes = makeNodes([
      node('p/r/lib/b/deep', 'module', 'p/r/lib/b'),
      node('p/r/lib/b/deep/x.ts', 'file', 'p/r/lib/b/deep', 100),
      node('p/r/lib/b/deep/deeper', 'module', 'p/r/lib/b/deep'),
      node('p/r/lib/b/deep/deeper/y.ts', 'file', 'p/r/lib/b/deep/deeper', 10),
      node('p/r/lib/b/deep/deeper/z.ts', 'file', 'p/r/lib/b/deep/deeper', 300),
    ])
    layoutWorld(nodes, EDGES, emptyLayout(), { gutter: 3 })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const rect = (id: string) => byId.get(id)?.rect ?? ZERO
    for (const n of nodes) {
      if (n.kind === 'symbol') continue
      const { x, y, w, h } = n.rect
      expect([x, y, w, h].every(Number.isInteger), n.id).toBe(true)
      const parent = n.parent ? byId.get(n.parent) : undefined
      if (!parent) continue
      expect(inside(n.rect, parent.rect), n.id).toBe(true)
      // Below the parent's label strip and inside its padding.
      if (parent.kind === 'module') {
        expect(n.rect.y, n.id).toBeGreaterThanOrEqual(parent.rect.y + 1)
        expect(n.rect.x, n.id).toBeGreaterThanOrEqual(parent.rect.x + 1)
        expect(n.rect.x + n.rect.w, n.id).toBeLessThanOrEqual(parent.rect.x + parent.rect.w - 1)
        expect(n.rect.y + n.rect.h, n.id).toBeLessThanOrEqual(parent.rect.y + parent.rect.h - 1)
      }
    }
    for (const [module, sub] of [
      ['p/r/lib/b', 'p/r/lib/b/deep'],
      ['p/r/lib/b/deep', 'p/r/lib/b/deep/deeper'],
    ] as const) {
      for (const file of nodes.filter((n) => n.parent === module && n.kind === 'file')) {
        expect(apart(file.rect, rect(sub), 3), `${file.id} / ${sub}`).toBe(true)
      }
    }
  })

  it('keeps a folder and its files in place when a subfolder arrives', () => {
    const store = emptyLayout()
    const first = makeNodes()
    layoutWorld(first, EDGES, store)
    const before = rects(first)
    const nested = makeNodes([
      node('p/r/app/web/hooks', 'module', 'p/r/app/web'),
      node('p/r/app/web/hooks/use.ts', 'file', 'p/r/app/web/hooks', 10),
    ])
    layoutWorld(nested, EDGES, store)
    for (const id of ['p/r/app/web', 'p/r/app/web/f0.ts', 'p/r/app/server', 'p/r/app/core']) {
      const after = nested.find((n) => n.id === id)?.rect
      const was = before.get(id) as Rect
      expect([after?.x, after?.y], id).toEqual([was.x, was.y])
    }
  })

  it('widens gutters to fit a lane per dependency, up to the cap', () => {
    // Every module imports every other one.
    const modules = makeNodes().filter((n) => n.kind === 'module')
    const edges = modules.flatMap((a) =>
      modules.filter((b) => b !== a).map((b) => importEdge(`${a.id}/f0.ts`, `${b.id}/f0.ts`)),
    )
    const narrow = makeNodes()
    layoutWorld(narrow, edges, emptyLayout(), { gutter: 2, maxGutter: 2 })
    const wide = makeNodes()
    layoutWorld(wide, edges, emptyLayout())
    const area = (nodes: WorldNode[]) => {
      const { w, h } = (nodes.find((n) => n.kind === 'world') as WorldNode).rect
      return w * h
    }
    expect(area(wide)).toBeGreaterThan(area(narrow))

    const boxes = buildRouteBoxes(wide)
    const graph = buildChannelGraph(boxes.root as NonNullable<typeof boxes.root>)
    const load = countChannelLoad(graph, listBlockLinks(edges, boxes.blockOf))
    graph.channels.forEach((channel, c) => {
      expect(laneCapacity(channel)).toBeGreaterThanOrEqual(Math.min(load[c] as number, 7))
    })
    for (const n of wide) {
      if (n.kind === 'symbol') continue
      expect(Number.isInteger(n.rect.x) && Number.isInteger(n.rect.y), n.id).toBe(true)
    }
  })

  it('rejects a gutter that is not a whole number of units', () => {
    expect(() => layoutWorld(makeNodes(), EDGES, emptyLayout(), { gutter: 1.5 })).toThrow(
      RangeError,
    )
  })

  it('places importers in the same row as or above the modules they import', () => {
    const nodes = makeNodes()
    layoutWorld(nodes, EDGES, emptyLayout())
    const y = (id: string) => nodes.find((n) => n.id === id)?.rect.y ?? Number.NaN
    expect(y('p/r/app/web')).toBeLessThanOrEqual(y('p/r/app/server'))
    expect(y('p/r/app/server')).toBeLessThanOrEqual(y('p/r/app/core'))
    expect(y('p/r/app/web')).toBeLessThan(y('p/r/app/core'))
  })

  it('keeps every file and module in place when a file or a module arrives', () => {
    const store = emptyLayout()
    const first = makeNodes()
    layoutWorld(first, EDGES, store)
    const before = rects(first)

    const withFile = makeNodes([node('p/r/lib/b/new.ts', 'file', 'p/r/lib/b', 10)])
    layoutWorld(withFile, EDGES, store)
    for (const [id, rect] of rects(withFile)) {
      if (before.has(id) && !id.includes('package:lib') && id !== 'p/r/lib/b') {
        expect(rect, id).toEqual(before.get(id))
      }
    }

    const withModule = makeNodes([
      node('p/r/app/extra', 'module', 'p/r/package:app'),
      node('p/r/app/extra/x.ts', 'file', 'p/r/app/extra', 10),
    ])
    const store2 = emptyLayout()
    layoutWorld(makeNodes(), EDGES, store2)
    layoutWorld(withModule, EDGES, store2)
    for (const id of ['p/r/app/web', 'p/r/app/server', 'p/r/app/core', 'p/r/app/web/f0.ts']) {
      expect(withModule.find((n) => n.id === id)?.rect, id).toEqual(before.get(id))
    }
  })

  it('lays out afresh from an empty store', () => {
    const store = emptyLayout()
    const a = makeNodes()
    layoutWorld(a, EDGES, store)
    const b = makeNodes()
    layoutWorld(b, EDGES, emptyLayout())
    expect(rects(b)).toEqual(rects(a))
  })
})
