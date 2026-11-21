import type { NodeKind } from '../shared/world-types.ts'

// Level-of-detail breakpoints, in screen pixels. Like labels on a web map,
// detail fades in over a band of sizes as you zoom, instead of switching at
// one key press per level.

// A container opens (its children fade in) as its shorter side grows over
// its band: a module as soon as its file squares are a few pixels wide. A
// file opens to show its symbols over FILE_OPEN.
export const CONTAINER_OPEN: Record<'project' | 'repo' | 'package' | 'module', Band> = {
  project: [40, 90],
  repo: [40, 90],
  package: [24, 48],
  module: [12, 24],
}
export const FILE_OPEN: Band = [150, 300]
// The background grid, one line per layout unit, fades in as the unit grows
// over this band; below it the lines would be too dense to read.
export const GRID_FADE: Band = [5, 12]
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
  return fade(px, kind === 'file' ? FILE_OPEN : CONTAINER_OPEN[kind])
}
