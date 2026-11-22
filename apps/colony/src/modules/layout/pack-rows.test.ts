import { describe, expect, it } from 'vitest'
import type { Rect } from '../world/world-types.ts'
import { packRows, type RowItem } from './pack-rows.ts'

const OPTIONS = { gutter: 2 }

function item(id: string, w: number, h: number, rank = 0): RowItem {
  return { id, rank, w, h }
}

// A module-like item that can be re-packed taller and narrower.
function module(id: string, w: number, h: number, rank = 0): RowItem {
  return { id, rank, w, h, fit: (to) => Math.max(2, Math.ceil((w * h) / to)) }
}

function items(count: number): RowItem[] {
  return Array.from({ length: count }, (_, i) =>
    module(`m${i}`, 3 + (i % 5), 3 + ((i * 3) % 7), i % 3),
  )
}

function expectApart(placed: Map<string, Rect>, gutter: number): void {
  const list = [...placed.entries()]
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [ia, a] = list[i] as [string, Rect]
      const [ib, b] = list[j] as [string, Rect]
      const apart =
        a.x + a.w + gutter <= b.x ||
        b.x + b.w + gutter <= a.x ||
        a.y + a.h + gutter <= b.y ||
        b.y + b.h + gutter <= a.y
      expect(apart, `${ia} ${JSON.stringify(a)} / ${ib} ${JSON.stringify(b)}`).toBe(true)
    }
  }
}

describe('packRows', () => {
  it('places every item on whole units, a gutter apart, inside the bounds', () => {
    const list = items(40)
    const { placed, width, height } = packRows(list, [], OPTIONS)
    expect(placed.size).toBe(40)
    expectApart(placed, OPTIONS.gutter)
    for (const rect of placed.values()) {
      expect([rect.x, rect.y, rect.w, rect.h].every(Number.isInteger)).toBe(true)
      expect(rect.x + rect.w).toBeLessThanOrEqual(width)
      expect(rect.y + rect.h).toBeLessThanOrEqual(height)
    }
    // Rows, not a strip.
    expect(width / height).toBeGreaterThan(0.5)
    expect(width / height).toBeLessThan(3)
  })

  it('puts importers above what they import on first placement', () => {
    const { placed } = packRows(
      [item('core', 6, 6, 0), item('web', 6, 6, 2), item('indexer', 6, 6, 1)],
      [],
      { gutter: 2 },
    )
    const y = (id: string) => placed.get(id)?.y ?? -1
    expect(y('web')).toBeLessThanOrEqual(y('indexer'))
    expect(y('indexer')).toBeLessThanOrEqual(y('core'))
  })

  it('stacks small items in one slot of a taller row', () => {
    const { rows, placed } = packRows(
      [module('big', 10, 12, 1), module('a', 4, 4), module('b', 3, 4)],
      [],
      OPTIONS,
    )
    expect(rows).toEqual([{ h: 12, slots: [['big'], ['a', 'b']] }])
    expect(placed.get('a')).toEqual({ x: 12, y: 0, w: 4, h: 4 })
    // Stacked items widen to their slot.
    expect(placed.get('b')).toEqual({ x: 12, y: 6, w: 4, h: 4 })
  })

  it('stretches an item nearly as tall as its row to the row height', () => {
    const { placed } = packRows([module('big', 10, 12, 1), module('tall', 4, 10)], [], OPTIONS)
    expect(placed.get('tall')).toMatchObject({ h: 12, w: Math.ceil(40 / 12) })
  })

  it('keeps a short lone item at its own height', () => {
    const { placed } = packRows([module('big', 10, 12, 1), module('mid', 4, 6)], [], OPTIONS)
    expect(placed.get('mid')).toMatchObject({ h: 6, w: 4 })
  })

  it('is deterministic', () => {
    expect(packRows(items(25), [], OPTIONS)).toEqual(packRows(items(25), [], OPTIONS))
  })

  it('keeps every placed item where it was when a new one arrives', () => {
    const first = packRows(items(20), [], OPTIONS)
    const next = packRows([...items(20), module('new', 3, 3)], first.rows, OPTIONS)
    for (const [id, rect] of first.placed) expect(next.placed.get(id)).toEqual(rect)
    expect(next.placed.has('new')).toBe(true)
    expectApart(next.placed, OPTIONS.gutter)
  })

  it('keeps the order when an item grows, moving only what follows it', () => {
    const first = packRows(items(20), [], OPTIONS)
    const grown = items(20).map((i) => (i.id === 'm5' ? module('m5', 12, i.h, i.rank) : i))
    const next = packRows(grown, first.rows, OPTIONS)
    expect(next.rows.map((row) => row.slots)).toEqual(first.rows.map((row) => row.slots))
    expectApart(next.placed, OPTIONS.gutter)
  })

  it('frees the place of a deleted item', () => {
    const first = packRows(items(20), [], OPTIONS)
    const next = packRows(
      items(20).filter((i) => i.id !== 'm7'),
      first.rows,
      OPTIONS,
    )
    expect(next.rows.flatMap((row) => row.slots.flat())).not.toContain('m7')
    expect(next.placed.size).toBe(19)
  })

  it('keeps a row height until its items need more, or less than half of it', () => {
    const first = packRows([module('a', 6, 10)], [], OPTIONS)
    expect(first.rows[0]?.h).toBe(10)
    expect(packRows([module('a', 6, 8)], first.rows, OPTIONS).rows[0]?.h).toBe(10)
    expect(packRows([module('a', 6, 12)], first.rows, OPTIONS).rows[0]?.h).toBe(12)
    expect(packRows([module('a', 6, 4)], first.rows, OPTIONS).rows[0]?.h).toBe(4)
  })

  it('puts a new item that outranks every saved row above them', () => {
    const saved = [{ h: 6, slots: [['a'], ['b'], ['c']] }]
    const { placed } = packRows(
      [item('a', 6, 6), item('b', 6, 6), item('c', 6, 6), item('n', 6, 6, 1)],
      saved,
      OPTIONS,
    )
    expect(placed.get('n')?.y).toBe(0)
    expect(placed.get('a')?.y).toBe(8)
  })

  it('ignores ids the saved rows list twice', () => {
    const next = packRows([item('a', 3, 3)], [{ h: 3, slots: [['a'], ['a']] }], OPTIONS)
    expect(next.rows).toEqual([{ h: 3, slots: [['a']] }])
  })
})
