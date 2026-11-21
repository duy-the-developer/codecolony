import type { Rect } from '../shared/world-types.ts'

// A stable row packer on the unit grid. A container's children sit in rows;
// each row is a line of slots, and a slot holds one large item or a stack of
// small ones. Order is the stable part: once placed, an item keeps its row,
// slot and place in the stack, and only sizes move things along. New items
// slot in by rank (importers above what they import), and deleted items free
// their place. A full relayout happens only when the caller passes no saved
// rows.

export interface RowItem {
  id: string
  // Higher ranks go in higher rows on first placement.
  rank: number
  // Natural size in whole units.
  w: number
  h: number
  // Width when stretched to a taller height. Items that have one fill the
  // row height when they are nearly as tall as the row, and widen to the
  // slot when stacked.
  fit?: (h: number) => number
}

export interface StoredRow {
  // Height in units, kept while the row's items still fit and need more than
  // half of it, so ordinary growth does not move every row below.
  h: number
  // Slots, left to right; each lists its items top to bottom.
  slots: string[][]
}

export interface PackRowsOptions {
  // Whole units between slots, between stacked items and between rows.
  gutter: number
}

export interface PackRowsResult {
  rows: StoredRow[]
  // Rectangle per item id, relative to the container's content area.
  placed: Map<string, Rect>
  width: number
  height: number
}

// New items fill rows up to about this width-to-height ratio.
const ASPECT = 1.6
// An item alone in its slot stretches to the row height when it is at least
// this share of it; a shorter one keeps its height rather than becoming a
// tall, mostly empty block.
const FILL_SHARE = 0.75

export function packRows(
  items: readonly RowItem[],
  saved: readonly StoredRow[],
  { gutter }: PackRowsOptions,
): PackRowsResult {
  const byId = new Map(items.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const rows: { stored: number | undefined; slots: RowItem[][] }[] = []
  for (const row of saved) {
    const slots: RowItem[][] = []
    for (const slot of row.slots) {
      const kept: RowItem[] = []
      for (const id of slot) {
        const item = byId.get(id)
        if (!item || seen.has(id)) continue
        seen.add(id)
        kept.push(item)
      }
      if (kept.length > 0) slots.push(kept)
    }
    if (slots.length > 0) rows.push({ stored: row.h, slots })
  }

  const pending = items
    .filter((item) => !seen.has(item.id))
    .sort((a, b) => b.rank - a.rank || b.w * b.h - a.w * a.h || (a.id < b.id ? -1 : 1))
  if (pending.length > 0) {
    let area = 0
    let widest = 0
    for (const item of items) {
      area += (item.w + gutter) * (item.h + gutter)
      widest = Math.max(widest, item.w)
    }
    const target = Math.max(
      widest,
      Math.ceil(Math.sqrt(area * ASPECT)),
      ...rows.map((row) => rowWidth(row.slots, gutter)),
    )
    const topRank = rows.map((row) => Math.max(...row.slots.flat().map((item) => item.rank)))
    for (const item of pending) {
      // The lowest row that still holds something ranked at or above the item.
      const r = topRank.findLastIndex((rank) => rank >= item.rank)
      const row = rows[r]
      if (row && insert(row, item, target, gutter)) {
        topRank[r] = Math.max(topRank[r] as number, item.rank)
        continue
      }
      const at = r + 1
      rows.splice(at, 0, { stored: undefined, slots: [[item]] })
      topRank.splice(at, 0, item.rank)
    }
  }

  const placed = new Map<string, Rect>()
  const stored: StoredRow[] = []
  let width = 0
  let y = 0
  for (const row of rows) {
    const need = Math.max(...row.slots.map((slot) => slotHeight(slot, gutter)))
    const h =
      row.stored !== undefined && need <= row.stored && 2 * need > row.stored ? row.stored : need
    let x = 0
    for (const slot of row.slots) {
      const [only] = slot
      if (only && slot.length === 1 && only.fit && only.h >= FILL_SHARE * h) {
        const w = only.fit(h)
        placed.set(only.id, { x, y, w, h })
        x += w + gutter
        continue
      }
      const w = Math.max(...slot.map((item) => item.w))
      let top = y
      for (const item of slot) {
        placed.set(item.id, { x, y: top, w: item.fit ? w : item.w, h: item.h })
        top += item.h + gutter
      }
      x += w + gutter
    }
    width = Math.max(width, x - gutter)
    y += h + gutter
    stored.push({ h, slots: row.slots.map((slot) => slot.map((item) => item.id)) })
  }
  return { rows: stored, placed, width, height: Math.max(0, y - gutter) }
}

// Two of an item fit in a row this tall.
function canShare(item: RowItem, rowHeight: number, gutter: number): boolean {
  return 2 * item.h + gutter <= rowHeight
}

function slotHeight(slot: readonly RowItem[], gutter: number): number {
  let h = -gutter
  for (const item of slot) h += item.h + gutter
  return h
}

function slotWidth(slot: readonly RowItem[]): number {
  return Math.max(...slot.map((item) => item.w))
}

function rowWidth(slots: readonly RowItem[][], gutter: number): number {
  let w = -gutter
  for (const slot of slots) w += slotWidth(slot) + gutter
  return Math.max(w, 0)
}

// Puts a new item on a stack with room, or in a new slot at the end of the
// row while the row stays within target. False when neither fits.
function insert(
  row: { stored: number | undefined; slots: RowItem[][] },
  item: RowItem,
  target: number,
  gutter: number,
): boolean {
  const need = Math.max(...row.slots.map((slot) => slotHeight(slot, gutter)))
  const h = Math.max(need, row.stored ?? 0)
  const width = rowWidth(row.slots, gutter)
  if (canShare(item, h, gutter)) {
    let best: RowItem[] | undefined
    for (const slot of row.slots) {
      const [first] = slot
      if (!first || !canShare(first, h, gutter)) continue
      if (slotHeight(slot, gutter) + gutter + item.h > h) continue
      const grows = Math.max(0, item.w - slotWidth(slot))
      if (grows === 0) {
        best = slot
        break
      }
      if (!best && width + grows <= target) best = slot
    }
    if (best) {
      best.push(item)
      return true
    }
  }
  if (width + gutter + item.w > target) return false
  row.slots.push([item])
  return true
}
