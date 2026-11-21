import { describe, expect, it } from 'vitest'
import { applySplices, diffSequences } from './sequence-diff.ts'
import type { Splice } from './world-types.ts'

function patch(a: string[], b: string[], maxEdits = 1000): string[] | undefined {
  const edits = diffSequences(a, b, maxEdits)
  if (!edits) return undefined
  const splices: Splice<string>[] = edits.map((edit) => [
    edit.at,
    edit.deleteCount,
    b.slice(edit.insertStart, edit.insertStart + edit.insertCount),
  ])
  return applySplices(a, splices, (item) => item)
}

// A deterministic pseudo-random sequence.
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return state / 2 ** 32
  }
}

describe('diffSequences', () => {
  it('turns one list into the other', () => {
    const cases: [string[], string[]][] = [
      [[], []],
      [[], ['a', 'b']],
      [['a', 'b'], []],
      [
        ['a', 'b', 'c', 'd'],
        ['a', 'x', 'c', 'd', 'e'],
      ],
      [
        ['a', 'a', 'b', 'a'],
        ['b', 'a', 'a', 'a'],
      ],
      [
        ['x', 'y', 'z'],
        ['z', 'y', 'x'],
      ],
    ]
    for (const [a, b] of cases) expect(patch(a, b)).toEqual(b)
  })

  it('handles random edits, duplicates included', () => {
    const next = random(7)
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: Math.floor(next() * 60) }, () => `k${Math.floor(next() * 40)}`)
      const b = [...a]
      for (let edit = Math.floor(next() * 6); edit > 0; edit--) {
        const at = Math.floor(next() * (b.length + 1))
        if (next() < 0.5) b.splice(at, 1)
        else b.splice(at, 0, `n${Math.floor(next() * 40)}`)
      }
      expect(patch(a, b)).toEqual(b)
    }
  })

  it('keeps a local change small', () => {
    const a = Array.from({ length: 1000 }, (_, i) => `k${i}`)
    const b = [...a.slice(0, 10), 'new', ...a.slice(11, 990), ...a.slice(991)]
    const edits = diffSequences(a, b, 1000) ?? []
    expect(edits.reduce((n, e) => n + e.deleteCount + e.insertCount, 0)).toBe(3)
  })

  it('gives up past maxEdits', () => {
    expect(diffSequences(['a', 'b', 'c'], ['x', 'y', 'z'], 5)).toBeUndefined()
  })
})
