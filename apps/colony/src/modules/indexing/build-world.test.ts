import { describe, expect, it } from 'vitest'
import { worldFromResponse } from '../wire/world-decoder.ts'
import { createWorldEncoder } from '../wire/world-encoder.ts'
import type { FileFacts, SymbolFact } from '../world/facts.ts'
import type { WorldResponse } from '../world/world-types.ts'
import { buildWorld } from './build-world.ts'
import type { IndexedFile } from './repo.ts'

function symbol(name: string, container?: string): SymbolFact {
  const made: SymbolFact = {
    name,
    kind: container ? 'method' : 'class',
    range: { start: 1, end: 3 },
    at: { line: 1, column: 0 },
    exported: true,
    complexity: 0,
  }
  if (container) made.container = container
  return made
}

function file(path: string, symbols: SymbolFact[] = []): IndexedFile {
  const facts: FileFacts = {
    language: 'typescript',
    lines: 10,
    complexity: 0,
    symbols,
    imports: [],
    calls: [],
    transports: [],
  }
  return { path, sha: path, facts }
}

describe('buildWorld', () => {
  it('puts every node after its parent, as the wire format needs', () => {
    // Files listed deepest first, in folders, subfolders and packages.
    const files = [
      file('src/web/deep/z.ts', [symbol('Z'), symbol('run', 'Z')]),
      file('src/web/a.ts'),
      file('src/b.ts'),
      file('packages/core/lib/c.ts', [symbol('C')]),
      file('packages/core/package.json'),
      file('README.md'),
    ]
    const { nodes, edges } = buildWorld([
      { name: 'demo', repos: [{ name: 'app', root: '/app', commit: 'abc', files }] },
    ])
    const world = { version: 1, indexedAt: '', languages: {}, nodes, edges }

    const state = worldFromResponse(
      JSON.parse(createWorldEncoder().encodeWorld(world)) as WorldResponse,
    )
    expect(state.world.nodes.map((node) => node.id)).toEqual(
      nodes.filter((node) => node.kind !== 'symbol').map((node) => node.id),
    )
  })
})
