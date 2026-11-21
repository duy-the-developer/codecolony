import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Colony } from '../indexer/colony.ts'
import { makeRepo, tempDir } from '../testing/git-fixture.ts'
import { CONTRACT_SAMPLES } from './contract.ts'
import { adapterFor, LANGUAGE_ADAPTERS } from './index.ts'

// Every language adapter must pass this suite on its own sample (see
// contract.ts). Adding a language means adding its sample.

describe.each(LANGUAGE_ADAPTERS.map((adapter) => [adapter.id, adapter] as const))(
  '%s adapter contract',
  (id, adapter) => {
    const sample = CONTRACT_SAMPLES[id]
    const repo = 'project:p/sample'
    const node = (ref: string) => `${repo}/${ref}`
    let colony: Colony

    beforeAll(async () => {
      if (!sample) return
      const root = makeRepo(sample.files, join(tempDir(), 'sample'))
      colony = new Colony({
        projects: [{ name: 'p', root, kind: 'repo' }],
        cacheDir: tempDir(),
        source: 'test',
      })
      await colony.refresh()
    })

    afterAll(() => colony?.close())

    it('ships a contract sample', () => {
      expect(sample, `add a sample for ${id} to CONTRACT_SAMPLES`).toBeDefined()
    })
    if (!sample) return

    it('claims the files of its sample', () => {
      for (const path of Object.keys(sample.files)) expect(adapterFor(path)?.id).toBe(id)
    })

    it('reads declarations with kind, container, export, lines and branches', () => {
      const nodes = new Map(colony.world.nodes.map((n) => [n.id, n]))
      for (const expected of sample.symbols) {
        const qualified = expected.container
          ? `${expected.container}.${expected.name}`
          : expected.name
        const found = nodes.get(node(`${expected.path}#${qualified}`))
        expect(found, `${expected.path}#${qualified}`).toBeDefined()
        expect(found?.symbolKind).toBe(expected.kind)
        if (expected.container) {
          expect(found?.parent).toBe(node(`${expected.path}#${expected.container}`))
        }
        if (expected.exported !== undefined) expect(found?.exported).toBe(expected.exported)
        if (expected.lines) {
          expect([found?.range?.start, found?.range?.end]).toEqual(expected.lines)
        }
        if (expected.complexity !== undefined) expect(found?.complexity).toBe(expected.complexity)
      }
    })

    it('resolves imports inside the repository', () => {
      const imports = colony.world.edges.filter((e) => e.kind === 'import')
      for (const expected of sample.imports) {
        const edge = imports.find(
          (e) => e.from === node(expected.from) && e.to === node(expected.to),
        )
        expect(edge, `${expected.from} -> ${expected.to}`).toBeDefined()
        expect(edge?.provenance).toBe('tree-sitter')
        if (expected.typeOnly !== undefined) expect(edge?.typeOnly).toBe(expected.typeOnly)
      }
    })

    it('resolves calls from the syntax tree', () => {
      const calls = colony.world.edges.filter((e) => e.kind === 'call')
      for (const expected of sample.calls) {
        expect(
          calls.find(
            (e) =>
              e.from === node(expected.from) &&
              e.to === node(expected.to) &&
              e.provenance === 'tree-sitter',
          ),
          `${expected.from} -> ${expected.to}`,
        ).toBeDefined()
      }
    })

    it('finds transports and links HTTP clients to routes', () => {
      for (const expected of sample.transports ?? []) {
        const file = colony.world.nodes.find((n) => n.id === node(expected.path))
        expect(file?.transports).toContainEqual(
          expect.objectContaining({ kind: expected.kind, target: expected.target }),
        )
      }
      for (const expected of sample.http ?? []) {
        expect(
          colony.world.edges.find(
            (e) =>
              e.kind === 'http' && e.from === node(expected.from) && e.to === node(expected.to),
          ),
        ).toBeDefined()
      }
    })

    it.runIf(adapter.languageServer)(
      'proves calls with its language server',
      async () => {
        expect(sample.semanticCalls?.length, 'semanticCalls are required').toBeGreaterThan(0)
        const files = new Set(
          (sample.semanticCalls ?? []).map((c) => c.from.slice(0, c.from.indexOf('#'))),
        )
        const edges = (await Promise.all([...files].map((f) => colony.deepIndex(node(f))))).flat()
        for (const expected of sample.semanticCalls ?? []) {
          expect(
            edges.find(
              (e) =>
                e.from === node(expected.from) &&
                e.to === node(expected.to) &&
                e.provenance === 'lsp',
            ),
            `${expected.from} -> ${expected.to}`,
          ).toBeDefined()
        }
      },
      60_000,
    )
  },
)
