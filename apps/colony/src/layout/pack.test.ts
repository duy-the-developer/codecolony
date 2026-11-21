import { describe, expect, it } from 'vitest'
import type { Rect } from '../shared/world-types.ts'
import { type PackItem, pack } from './pack.ts'

const OPTIONS = { gap: 1, slack: 1.12 }

function items(count: number, size = (i: number) => 4 + (i % 5)): PackItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: `f${i}`, w: size(i), h: size(i) }))
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function expectNoOverlap(rects: Map<string, Rect>): void {
  const list = [...rects.values()]
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (a && b) expect(overlap(a, b), `${JSON.stringify(a)} / ${JSON.stringify(b)}`).toBe(false)
    }
  }
}

describe('pack', () => {
  it('reserves a non-overlapping rectangle at least as big as each item', () => {
    const list = items(40)
    const { reserved, width, height } = pack(list, new Map(), OPTIONS)
    expectNoOverlap(reserved)
    for (const item of list) {
      const rect = reserved.get(item.id)
      expect(rect?.w).toBeGreaterThanOrEqual(item.w)
      expect(rect?.h).toBeGreaterThanOrEqual(item.h)
    }
    // Roughly square, not a strip.
    expect(width / height).toBeGreaterThan(0.5)
    expect(width / height).toBeLessThan(2)
  })

  it('is deterministic', () => {
    expect(pack(items(25), new Map(), OPTIONS)).toEqual(pack(items(25), new Map(), OPTIONS))
  })

  it('keeps every existing item in place when a new one arrives', () => {
    const first = pack(items(20), new Map(), OPTIONS)
    const next = pack([...items(20), { id: 'new', w: 6, h: 6 }], first.reserved, OPTIONS)
    for (const [id, rect] of first.reserved) expect(next.reserved.get(id)).toEqual(rect)
    expect(next.reserved.has('new')).toBe(true)
    expectNoOverlap(next.reserved)
  })

  it('keeps an item that grows within its reservation, and moves only one that outgrows it', () => {
    const first = pack(items(20), new Map(), OPTIONS)
    const grown = items(20).map((item) =>
      item.id === 'f3' ? { ...item, w: item.w * 1.05, h: item.h * 1.05 } : item,
    )
    expect(pack(grown, first.reserved, OPTIONS).reserved).toEqual(first.reserved)

    const outgrown = items(20).map((item) =>
      item.id === 'f3' ? { ...item, w: item.w * 1.5, h: item.h * 1.5 } : item,
    )
    const next = pack(outgrown, first.reserved, OPTIONS)
    for (const [id, rect] of first.reserved) {
      if (id !== 'f3') expect(next.reserved.get(id)).toEqual(rect)
    }
    expect(next.reserved.get('f3')?.w).toBeGreaterThanOrEqual(outgrown[3]?.w ?? Infinity)
    expectNoOverlap(next.reserved)
  })

  it('grows an outgrown item in place when the space around it is free', () => {
    const first = pack([{ id: 'a', w: 10, h: 10 }], new Map(), OPTIONS)
    const next = pack([{ id: 'a', w: 12, h: 12 }], first.reserved, OPTIONS)
    expect(next.reserved.get('a')).toMatchObject({ x: 0, y: 0 })
    expect(next.reserved.get('a')?.w).toBeGreaterThanOrEqual(12)
  })

  it('holds the place of a deleted item so its neighbours stay put', () => {
    const first = pack(items(20), new Map(), OPTIONS)
    const next = pack(
      items(20).filter((item) => item.id !== 'f7'),
      first.reserved,
      OPTIONS,
    )
    expect(next.reserved).toEqual(first.reserved)
  })

  it('packs afresh when moves have left the container mostly empty', () => {
    const first = pack(items(30), new Map(), OPTIONS)
    // Every item doubles: all move, leaving the old area as holes.
    const doubled = items(30, (i) => 2 * (4 + (i % 5)))
    const next = pack(doubled, first.reserved, OPTIONS)
    const fresh = pack(doubled, new Map(), OPTIONS)
    expect(next).toEqual(fresh)
  })
})
