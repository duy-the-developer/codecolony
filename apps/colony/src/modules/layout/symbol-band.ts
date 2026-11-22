import type { LineRange, Rect } from '../world/world-types.ts'

// Symbols are drawn as bands over their file: the vertical position and
// height follow their line range, so the band shows where the code sits. The
// layout places them on the server and the page places the symbols it loads,
// with this one formula, so both get the same rectangles.

// holder: the enclosing symbol's rectangle, or undefined directly in the file.
export function symbolBand(
  range: LineRange,
  file: Rect,
  fileLines: number,
  holder: Rect | undefined,
): Rect {
  const inset = 0.08 * Math.min(file.w, file.h)
  const top = file.y + inset
  const height = file.h - 2 * inset
  const lines = Math.max(fileLines, 1)
  const y = top + ((range.start - 1) / lines) * height
  const h = Math.max(((range.end - range.start + 1) / lines) * height, height / Math.max(lines, 40))
  const x = holder ? holder.x + 0.08 * holder.w : file.x + inset
  const w = holder ? 0.88 * holder.w : file.w - 2 * inset
  return { x, y, w, h }
}
