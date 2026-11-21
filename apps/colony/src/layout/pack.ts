import type { Rect } from '../shared/world-types.ts'

// A stable rectangle packer. Each child keeps a reserved rectangle across
// runs: while it still fits there it does not move, a child that outgrows its
// reservation grows in place if the space around it is free or else moves
// alone, and new children take free space. Reservations of
// children that disappeared stay held, so a deleted file leaves a gap rather
// than shifting its neighbours (and replay can show it again). When moves and
// ghosts leave the container mostly empty, it is packed afresh once.

export interface PackItem {
  id: string
  w: number
  h: number
}

export interface PackOptions {
  gap: number
  // New reservations are this much larger than the item, room to grow.
  slack: number
}

// Below this share of live item area in the packed bounds, start afresh.
export const MIN_FILL = 0.4

export interface PackResult {
  // Reserved rectangle per id, ghosts included. Items sit at its top left.
  reserved: Map<string, Rect>
  width: number
  height: number
}

export function pack(
  items: readonly PackItem[],
  saved: ReadonlyMap<string, Rect>,
  { gap, slack }: PackOptions,
): PackResult {
  const reserved = new Map<string, Rect>()
  const present = new Map(items.map((item) => [item.id, item]))
  for (const [id, rect] of saved) {
    const item = present.get(id)
    if (!item || (item.w <= rect.w && item.h <= rect.h)) reserved.set(id, rect)
  }

  const pending = items
    .filter((item) => !reserved.has(item.id))
    .sort((a, b) => b.w * b.h - a.w * a.h || (a.id < b.id ? -1 : 1))
  if (pending.length > 0) {
    const placed = [...reserved.values()]
    let area = 0
    for (const rect of placed) area += (rect.w + gap) * (rect.h + gap)
    for (const item of pending) area += (item.w * slack + gap) * (item.h * slack + gap)
    const widest = Math.max(0, ...pending.map((item) => item.w * slack))
    const width = Math.max(bounds(placed).width, Math.sqrt(area), widest)
    for (const item of pending) {
      // An item that outgrew its reservation first tries to grow where it is.
      const before = saved.get(item.id)
      const grown = before && { x: before.x, y: before.y, w: item.w * slack, h: item.h * slack }
      const rect =
        grown && grown.x + grown.w <= width && !placed.some((other) => overlaps(grown, other, gap))
          ? grown
          : place(item.w * slack, item.h * slack, placed, width, gap)
      placed.push(rect)
      reserved.set(item.id, rect)
    }
  }
  const { width, height } = bounds([...reserved.values()])
  const result = { reserved, width, height }
  if (saved.size === 0 || fill(items, result) >= MIN_FILL) return result
  // Only when a fresh packing really is tighter, so this cannot repeat.
  const fresh = pack(items, new Map(), { gap, slack })
  return fill(items, fresh) > fill(items, result) ? fresh : result
}

function fill(items: readonly PackItem[], { width, height }: PackResult): number {
  if (width <= 0 || height <= 0) return 1
  let used = 0
  for (const item of items) used += item.w * item.h
  return used / (width * height)
}

// Bottom-left placement: the lowest, then leftmost, free spot within width.
function place(w: number, h: number, placed: Rect[], width: number, gap: number): Rect {
  const candidates: [number, number][] = [[0, 0]]
  for (const rect of placed) {
    candidates.push([rect.x + rect.w + gap, rect.y], [rect.x, rect.y + rect.h + gap])
    candidates.push([0, rect.y + rect.h + gap])
  }
  candidates.sort((a, b) => a[1] - b[1] || a[0] - b[0])
  for (const [x, y] of candidates) {
    if (x + w > width + 1e-9) continue
    const rect = { x, y, w, h }
    if (!placed.some((other) => overlaps(rect, other, gap))) return rect
  }
  return { x: 0, y: bounds(placed).height + (placed.length > 0 ? gap : 0), w, h }
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap - 1e-9 &&
    b.x < a.x + a.w + gap - 1e-9 &&
    a.y < b.y + b.h + gap - 1e-9 &&
    b.y < a.y + a.h + gap - 1e-9
  )
}

function bounds(rects: readonly Rect[]): { width: number; height: number } {
  let width = 0
  let height = 0
  for (const rect of rects) {
    width = Math.max(width, rect.x + rect.w)
    height = Math.max(height, rect.y + rect.h)
  }
  return { width, height }
}
