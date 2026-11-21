// Files are squares on the module's cell grid, one to four cells wide by line
// count, and fill columns from the top down in the order given.

// The most lines a file can hold at each width: 6, 12 and 18 squared, so the
// side tracks the square root of the line count.
export const FILE_TIERS = [36, 144, 324] as const

export function fileUnits(lines: number): number {
  const tier = FILE_TIERS.findIndex((most) => lines <= most)
  return tier < 0 ? FILE_TIERS.length + 1 : tier + 1
}

export interface CellPacking {
  // Top left cell of each item, in the order given.
  cells: { x: number; y: number }[]
  width: number
}

// Packs squares into columns no taller than height. A column is as wide as
// its first square; smaller squares share a row of the column while they fit
// across it. A square too wide for the column starts the next one.
export function packCells(sizes: readonly number[], height: number): CellPacking {
  const cells: { x: number; y: number }[] = []
  let x = 0
  let columnWidth = 0
  // The current row inside the column: its top, height and filled width.
  let rowY = 0
  let rowHeight = 0
  let rowX = 0
  for (const size of sizes) {
    if (columnWidth > 0 && rowX + size <= columnWidth && rowY + size <= height) {
      cells.push({ x: x + rowX, y: rowY })
      rowX += size
      rowHeight = Math.max(rowHeight, size)
      continue
    }
    const nextY = rowY + rowHeight
    if (columnWidth > 0 && size <= columnWidth && nextY + size <= height) {
      rowY = nextY
    } else {
      x += columnWidth
      columnWidth = size
      rowY = 0
    }
    cells.push({ x, y: rowY })
    rowX = size
    rowHeight = size
  }
  return { cells, width: x + columnWidth }
}

// The height a module's files are packed to before its row stretches it:
// about square, and never shorter than its largest file.
export function naturalHeight(sizes: readonly number[]): number {
  let area = 0
  let largest = 1
  for (const size of sizes) {
    area += size * size
    largest = Math.max(largest, size)
  }
  return Math.max(largest, Math.ceil(Math.sqrt(area)))
}
