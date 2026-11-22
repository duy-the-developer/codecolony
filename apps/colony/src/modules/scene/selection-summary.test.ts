import { describe, expect, it } from 'vitest'
import type { Edge, NodeKind, World, WorldNode } from '../world/world-types.ts'
import { Scene } from './scene.ts'
import { buildSelectionSummary } from './selection-summary.ts'

function node(id: string, kind: NodeKind, parent?: string): WorldNode {
  const base = { id, kind, name: id, lines: 10, complexity: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }
  return parent === undefined ? base : { ...base, parent }
}

function edge(kind: Edge['kind'], from: string, to: string): Edge {
  return { kind, from, to, provenance: 'tree-sitter' }
}

// world > module a (f.ts, h.ts), module b (g.ts), and c.ts on its own.
const scene = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node('w', 'world'),
    node('a', 'module', 'w'),
    node('a/f.ts', 'file', 'a'),
    node('a/h.ts', 'file', 'a'),
    node('b', 'module', 'w'),
    node('b/g.ts', 'file', 'b'),
    node('c.ts', 'file', 'w'),
  ],
  edges: [
    edge('import', 'a/f.ts', 'b/g.ts'),
    edge('import', 'a/f.ts', 'a/h.ts'),
    edge('import', 'a/h.ts', 'c.ts'),
    edge('import', 'c.ts', 'b/g.ts'),
    edge('import', 'c.ts', 'a/f.ts'),
    edge('call', 'c.ts', 'a/f.ts'),
  ],
} satisfies World)

function get(id: string): WorldNode {
  const found = scene.byId.get(id)
  if (!found) throw new Error(id)
  return found
}

describe('buildSelectionSummary', () => {
  it('counts files and imports between, out of and into the selection', () => {
    const summary = buildSelectionSummary(scene, [get('a'), get('b')])
    expect(summary).toMatchObject({
      files: 3,
      importsBetween: 1,
      importsOut: 1,
      importedBy: 2,
    })
  })

  it('lists the edges of the selection as a whole, leaving out those between', () => {
    const summary = buildSelectionSummary(scene, [get('a'), get('b')])
    expect(summary.sections.map((s) => [s.title, s.total])).toEqual([
      ['Imports', 1],
      ['Imported by', 2],
      ['Called by', 1],
    ])
  })

  it('counts a file once when selected nodes overlap', () => {
    const summary = buildSelectionSummary(scene, [get('a'), get('a/f.ts')])
    expect(summary.files).toBe(2)
    // f.ts to h.ts leaves f.ts, though both are inside a.
    expect(summary.importsBetween).toBe(1)
  })
})
