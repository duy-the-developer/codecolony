import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Edge, NodeKind, Rect, WorldNode } from '../shared/world-types.ts'
import { emptyLayout, layoutWorld, loadLayout, looseId, saveLayout } from './world-layout.ts'

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

  it('keeps files from touching neighbours outside their cells, and modules a gutter apart', () => {
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
          expect(apart((group[i] as WorldNode).rect, (group[j] as WorldNode).rect, 0)).toBe(true)
        }
      }
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

describe('loadLayout', () => {
  it('reads back what saveLayout wrote', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'codecolony-layout-')), 'layout.json')
    const store = emptyLayout()
    layoutWorld(makeNodes(), EDGES, store)
    saveLayout(path, store)
    expect(loadLayout(path)).toEqual(store)
  })

  it('migrates repository and package root modules to loose-file groups', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'codecolony-layout-')), 'layout.json')
    const v2 = {
      version: 2,
      rows: {
        world: [{ h: 40, slots: [['p']] }],
        p: [{ h: 38, slots: [['p/r']] }],
        'p/r': [{ h: 30, slots: [['p/r/package:.'], ['p/r/package:app']] }],
        'p/r/package:.': [
          { h: 4, slots: [['p/r/.', 'p/r/docs']] },
          { h: 6, slots: [['p/r/scripts']] },
        ],
        'p/r/package:app': [{ h: 10, slots: [['p/r/app'], ['p/r/app/web']] }],
      },
      modules: {
        'p/r/.': { files: ['p/r/README.md'], h: 1 },
        'p/r/docs': { files: ['p/r/docs/a.md'], h: 1 },
        'p/r/app': { files: ['p/r/app/index.ts'], h: 2 },
      },
    }
    writeFileSync(path, JSON.stringify(v2))
    const store = loadLayout(path)
    expect(store.rows.get('p/r')).toEqual([
      { h: 4, slots: [[looseId('p/r'), 'p/r/docs']] },
      { h: 6, slots: [['p/r/scripts']] },
      { h: 30, slots: [['p/r/package:app']] },
    ])
    expect(store.rows.has('p/r/package:.')).toBe(false)
    expect(store.rows.get('p/r/package:app')).toEqual([
      { h: 10, slots: [[looseId('p/r/package:app')], ['p/r/app/web']] },
    ])
    expect(store.modules.get(looseId('p/r'))).toEqual({ files: ['p/r/README.md'], h: 1 })
    expect(store.modules.get(looseId('p/r/package:app'))).toEqual({
      files: ['p/r/app/index.ts'],
      h: 2,
    })
    expect(store.modules.has('p/r/.')).toBe(false)
    expect(store.modules.get('p/r/docs')).toEqual(v2.modules['p/r/docs'])
  })

  it('drops a layout saved in an older format', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'codecolony-layout-')), 'layout.json')
    writeFileSync(path, JSON.stringify({ slots: { world: {} }, pads: {} }))
    expect(loadLayout(path)).toEqual(emptyLayout())
  })
})
