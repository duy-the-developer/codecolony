import { describe, expect, it } from 'vitest'
import type { World, WorldNode } from '../shared/world-types.ts'
import { buildSearchIndex, listSearchMatches } from './search-index.ts'

const RECT = { x: 0, y: 0, w: 1, h: 1 }

function node(id: string, kind: WorldNode['kind'], name: string, path?: string): WorldNode {
  const made: WorldNode = { id, kind, name, lines: 10, complexity: 0, rect: RECT }
  if (path) made.path = path
  return made
}

const WORLD: World = {
  version: 1,
  indexedAt: '',
  languages: {},
  edges: [],
  nodes: [
    node('world', 'world', 'world'),
    node('r/src', 'module', 'src', 'src'),
    node('r/src/pack.ts', 'file', 'pack.ts', 'src/pack.ts'),
    node('r/src/pack.test.ts', 'file', 'pack.test.ts', 'src/pack.test.ts'),
    node('r/src/packer/index.ts', 'file', 'index.ts', 'src/packer/index.ts'),
    {
      ...node('r/src/pack.ts#pack', 'symbol', 'pack', 'src/pack.ts'),
      range: { start: 33, end: 73 },
    },
    node('r/src/pack.ts#PackOptions', 'symbol', 'PackOptions', 'src/pack.ts'),
    node('r/src/pack.ts#unpack', 'symbol', 'unpack', 'src/pack.ts'),
  ],
}

describe('listSearchMatches', () => {
  const index = buildSearchIndex(WORLD)

  it('ranks exact, then prefix, then substring name matches', () => {
    const { symbols } = listSearchMatches(index, 'pack', 10)
    expect(symbols.map((s) => s.name)).toEqual(['pack', 'PackOptions', 'unpack'])
    expect(symbols[0]?.line).toBe(33)
  })

  it('matches files on their path after their name', () => {
    const { files } = listSearchMatches(index, 'pack', 10)
    expect(files.map((f) => f.path)).toEqual([
      'src/pack.ts',
      'src/pack.test.ts',
      'src/packer/index.ts',
    ])
  })

  it('ignores case and leaves out folders', () => {
    const { symbols, files } = listSearchMatches(index, 'SRC', 10)
    expect(symbols).toEqual([])
    expect(files).toHaveLength(3)
  })

  it('caps each group and returns nothing for a blank query', () => {
    expect(listSearchMatches(index, 'pack', 1).files).toHaveLength(1)
    expect(listSearchMatches(index, '  ', 10)).toEqual({ symbols: [], files: [] })
  })
})
