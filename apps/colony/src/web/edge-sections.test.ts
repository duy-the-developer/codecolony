import { describe, expect, it } from 'vitest'
import type { Edge, World, WorldNode } from '../shared/world-types.ts'
import { describeEdgeRow, listEdgeSections } from './edge-sections.ts'
import { Scene } from './scene.ts'

const RECT = { x: 0, y: 0, w: 1, h: 1 }

function node(id: string, kind: WorldNode['kind'], parent?: string): WorldNode {
  const made: WorldNode = {
    id,
    kind,
    name: id.split('/').pop() ?? id,
    lines: 1,
    complexity: 0,
    rect: RECT,
  }
  if (parent) made.parent = parent
  if (kind !== 'world') made.path = id
  return made
}

function edge(kind: Edge['kind'], from: string, to: string, label?: string): Edge {
  const made: Edge = { kind, from, to, provenance: 'tree-sitter' }
  if (label) made.label = label
  return made
}

const SCENE = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node('world', 'world'),
    node('web', 'dir', 'world'),
    node('web/main.ts', 'file', 'web'),
    node('server', 'dir', 'world'),
    node('server/api.ts', 'file', 'server'),
    node('core', 'dir', 'world'),
    node('core/model.ts', 'file', 'core'),
  ],
  edges: [
    edge('import', 'server/api.ts', 'core/model.ts'),
    edge('import', 'web/main.ts', 'server/api.ts'),
    edge('import', 'web/main.ts', 'server/api.ts'),
    edge('http', 'web/main.ts', 'server/api.ts', 'GET /api/world'),
    edge('call', 'server/api.ts', 'server/api.ts'),
  ],
} satisfies World)

describe('listEdgeSections', () => {
  it('names each direction with engineering terms and leaves out inner edges', () => {
    const sections = listEdgeSections(SCENE, new Set(['server', 'server/api.ts']))
    expect(sections.map((s) => [s.title, s.total])).toEqual([
      ['Imports', 1],
      ['Imported by', 2],
      ['HTTP routes served', 1],
    ])
  })

  it('groups repeated edges into one row with a count', () => {
    const [, importedBy] = listEdgeSections(SCENE, new Set(['server/api.ts']))
    expect(importedBy?.rows).toHaveLength(1)
    expect(importedBy?.rows[0]?.count).toBe(2)
  })

  it('labels HTTP rows by route', () => {
    const sections = listEdgeSections(SCENE, new Set(['web/main.ts']))
    const http = sections.find((s) => s.kind === 'http')
    expect(http?.title).toBe('HTTP requests')
    const row = http?.rows[0]
    expect(row && describeEdgeRow(SCENE, row, 'out')).toBe('GET /api/world → server/api.ts')
  })
})
