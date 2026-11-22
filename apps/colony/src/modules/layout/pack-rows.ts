import type { Rect } from '../world/world-types.ts'

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
  // Whole units some gaps are widened by, to make room for dependency lanes.
  widen?: GapWidening
  // A width-to-height ratio for the whole: new items fill rows to the width
  // that brings the packed rows closest to it. Without one, rows fill to
  // about ASPECT, judged by area.
  aspect?: number
}

// Extra units per gap, keyed by item id: the gap above the row that holds the
// item, the gap left of the slot that holds it, and the gap above it in its
// stack. The first row, slot and stacked item have no gap before them.
export interface GapWidening {
  rows: ReadonlyMap<string, number>
  slots: ReadonlyMap<string, number>
  stacks: ReadonlyMap<string, number>
}

const NO_WIDENING: GapWidening = { rows: new Map(), slots: new Map(), stacks: new Map() }

interface Row {
  stored: number | undefined
  slots: RowItem[][]
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
  { gutter, widen = NO_WIDENING, aspect }: PackRowsOptions,
): PackRowsResult {
  const byId = new Map(items.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const rows: Row[] = []
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
    const least = Math.max(widest, ...rows.map((row) => rowWidth(row.slots, gutter)))
    const target =
      aspect === undefined
        ? Math.max(least, Math.ceil(Math.sqrt(area * ASPECT)))
        : fitTarget(rows, pending, least, aspect, gutter)
    fillRows(rows, pending, target, gutter)
  }

  // Extra units before a row or slot: the most any of its items asks for.
  const extraBefore = (map: ReadonlyMap<string, number>, list: readonly RowItem[]) =>
    Math.max(0, ...list.map((item) => map.get(item.id) ?? 0))
  const stackGap = (item: RowItem) => gutter + (widen.stacks.get(item.id) ?? 0)

  const placed = new Map<string, Rect>()
  const stored: StoredRow[] = []
  let width = 0
  let y = 0
  rows.forEach((row, r) => {
    if (r > 0) y += gutter + extraBefore(widen.rows, row.slots.flat())
    const need = Math.max(...row.slots.map((slot) => slotHeight(slot, stackGap)))
    const h =
      row.stored !== undefined && need <= row.stored && 2 * need > row.stored ? row.stored : need
    let x = 0
    row.slots.forEach((slot, s) => {
      if (s > 0) x += gutter + extraBefore(widen.slots, slot)
      const [only] = slot
      if (only && slot.length === 1 && only.fit && only.h >= FILL_SHARE * h) {
        const w = only.fit(h)
        placed.set(only.id, { x, y, w, h })
        x += w
        return
      }
      const w = Math.max(...slot.map((item) => item.w))
      let top = y
      slot.forEach((item, k) => {
        if (k > 0) top += stackGap(item)
        placed.set(item.id, { x, y: top, w: item.fit ? w : item.w, h: item.h })
        top += item.h
      })
      x += w
    })
    width = Math.max(width, x)
    y += h
    stored.push({ h, slots: row.slots.map((slot) => slot.map((item) => item.id)) })
  })
  return { rows: stored, placed, width, height: y }
}

// Places new items, highest rank first, in the lowest row that holds
// something ranked at or above them, or in a new row below it.
function fillRows(rows: Row[], pending: readonly RowItem[], target: number, gutter: number): void {
  const topRank = rows.map((row) => Math.max(...row.slots.flat().map((item) => item.rank)))
  for (const item of pending) {
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

// The row width, from least up, that packs the rows closest to `aspect`: one
// try per width that fits one more of the new items in a row.
function fitTarget(
  rows: readonly Row[],
  pending: readonly RowItem[],
  least: number,
  aspect: number,
  gutter: number,
): number {
  const widths = new Set([least])
  let run = -gutter
  for (const item of pending) {
    run += item.w + gutter
    widths.add(Math.max(least, run))
  }
  let best = least
  let bestMiss = Number.POSITIVE_INFINITY
  for (const width of [...widths].sort((a, b) => a - b)) {
    const trial = rows.map((row) => ({ stored: row.stored, slots: row.slots.map((s) => [...s]) }))
    fillRows(trial, pending, width, gutter)
    let w = 0
    let h = -gutter
    for (const row of trial) {
      w = Math.max(w, rowWidth(row.slots, gutter))
      h += gutter + Math.max(row.stored ?? 0, ...row.slots.map((slot) => slotHeight(slot, gutter)))
    }
    const miss = Math.abs(Math.log(w / h / aspect))
    if (miss < bestMiss) {
      best = width
      bestMiss = miss
    }
  }
  return best
}

// Two of an item fit in a row this tall.
function canShare(item: RowItem, rowHeight: number, gutter: number): boolean {
  return 2 * item.h + gutter <= rowHeight
}

// A stack's height, with the gap above each item after the first.
function slotHeight(slot: readonly RowItem[], gap: number | ((item: RowItem) => number)): number {
  let h = 0
  slot.forEach((item, k) => {
    if (k > 0) h += typeof gap === 'number' ? gap : gap(item)
    h += item.h
  })
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
function insert(row: Row, item: RowItem, target: number, gutter: number): boolean {
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
