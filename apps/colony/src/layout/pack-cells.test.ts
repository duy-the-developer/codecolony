import { describe, expect, it } from 'vitest'
import { fileUnits, naturalHeight, packCells } from './pack-cells.ts'

function overlaps(sizes: number[], cells: { x: number; y: number }[]): boolean {
  for (let i = 0; i < sizes.length; i++) {
    for (let j = i + 1; j < sizes.length; j++) {
      const a = cells[i] as { x: number; y: number }
      const b = cells[j] as { x: number; y: number }
      const sa = sizes[i] as number
      const sb = sizes[j] as number
      if (a.x < b.x + sb && b.x < a.x + sa && a.y < b.y + sb && b.y < a.y + sa) return true
    }
  }
  return false
}

describe('fileUnits', () => {
  it('sizes files one to four cells by line tier', () => {
    expect([0, 36, 37, 144, 145, 324, 325, 50_000].map(fileUnits)).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('packCells', () => {
  it('fills columns from the top down and never overlaps', () => {
    const sizes = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1]
    const { cells, width } = packCells(sizes, 6)
    expect(overlaps(sizes, cells)).toBe(false)
    sizes.forEach((size, i) => {
      const cell = cells[i] as { x: number; y: number }
      expect(Number.isInteger(cell.x) && Number.isInteger(cell.y)).toBe(true)
      expect(cell.y + size).toBeLessThanOrEqual(6)
      expect(cell.x + size).toBeLessThanOrEqual(width)
    })
    expect(cells[0]).toEqual({ x: 0, y: 0 })
  })

  it('shares a column row between small squares', () => {
    expect(packCells([2, 1, 1], 2).cells).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ])
    expect(packCells([2, 1, 1, 1, 1], 4)).toEqual({
      cells: [
        { x: 0, y: 0 },
        { x: 0, y: 2 },
        { x: 1, y: 2 },
        { x: 0, y: 3 },
        { x: 1, y: 3 },
      ],
      width: 2,
    })
  })

  it('starts a new column for a square wider than the current one', () => {
    expect(packCells([1, 3], 4).cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
  })
})

describe('naturalHeight', () => {
  it('is about square and at least the largest file', () => {
    expect(naturalHeight([1, 1, 1, 1])).toBe(2)
    expect(naturalHeight([4])).toBe(4)
    expect(naturalHeight([])).toBe(1)
  })
})
