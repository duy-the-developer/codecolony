import type { NodeKind } from '../shared/world-types.ts'

// Level-of-detail breakpoints, in screen pixels. Like labels on a web map,
// detail fades in over a band of sizes as you zoom, instead of switching at
// one key press per level.

// A container opens (its children fade in) as its shorter side grows over
// this band; a file opens to show its symbols over the second band.
export const CONTAINER_OPEN: Band = [70, 150]
export const FILE_OPEN: Band = [150, 300]
// Labels fade in over these font sizes.
export const LABEL_FONT: Band = [7, 10]
// Nodes smaller than this are not drawn at all.
export const MIN_VISIBLE_PX = 1.5

export type Band = readonly [number, number]

// 0 below the band, 1 above it, smooth in between.
export function fade(px: number, [from, to]: Band): number {
  if (px <= from) return 0
  if (px >= to) return 1
  const t = (px - from) / (to - from)
  return t * t * (3 - 2 * t)
}

// How far a node shows its children at a given on-screen size (shorter side).
export function openness(kind: NodeKind, px: number): number {
  if (kind === 'world') return 1
  if (kind === 'symbol') return fade(px, FILE_OPEN)
  return fade(px, kind === 'file' ? FILE_OPEN : CONTAINER_OPEN)
}
