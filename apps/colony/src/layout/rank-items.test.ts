import { describe, expect, it } from 'vitest'
import { rankItems } from './rank-items.ts'

function graph(pairs: [string, string][]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [from, to] of pairs) out.set(from, (out.get(from) ?? new Set()).add(to))
  return out
}

describe('rankItems', () => {
  it('ranks an importer one above the highest item it imports', () => {
    const ranks = rankItems(
      ['web', 'server', 'indexer', 'core', 'loose'],
      graph([
        ['server', 'indexer'],
        ['indexer', 'core'],
        ['web', 'core'],
      ]),
    )
    expect(Object.fromEntries(ranks)).toEqual({ web: 1, server: 2, indexer: 1, core: 0, loose: 0 })
  })

  it('gives an import cycle one shared rank', () => {
    const ranks = rankItems(
      ['a', 'b', 'c', 'd'],
      graph([
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'b'],
        ['c', 'd'],
      ]),
    )
    expect(Object.fromEntries(ranks)).toEqual({ a: 2, b: 1, c: 1, d: 0 })
  })

  it('ignores self-imports and items outside the list', () => {
    const ranks = rankItems(
      ['a'],
      graph([
        ['a', 'a'],
        ['a', 'elsewhere'],
      ]),
    )
    expect(ranks.get('a')).toBe(0)
  })

  it('handles long chains without overflowing the stack', () => {
    const ids = Array.from({ length: 50_000 }, (_, i) => `m${i}`)
    const pairs = ids.slice(1).map((id, i) => [id, ids[i]] as [string, string])
    expect(rankItems(ids, graph(pairs)).get('m49999')).toBe(49_999)
  })
})
