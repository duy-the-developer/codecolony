import type { EdgeKind } from '../world/world-types.ts'

// Overlays draw one layer over the map. All are off by default: the map shows
// only blocks and the colonists' robots. Connection overlays draw edges: with
// none on, hovering or selecting a node shows its connections from every
// overlay; with one on, all of its connections show and hovering a node
// highlights that node's. The Git overlay draws every colonist's diff
// outlines, the Owners overlay a pin on every file a colonist changes.

export interface Overlay {
  id: string
  name: string
  // The edge kinds it draws; none for an overlay of colonist changes.
  kinds: readonly EdgeKind[]
  color: string
  // The digit that toggles it (#47); 0 switches every overlay off.
  key: string
}

export const OVERLAYS = [
  { id: 'dependency', name: 'Dependency', kinds: ['import'], color: '#6aa8ff', key: '1' },
  { id: 'git', name: 'Git', kinds: [], color: '#4f9fe8', key: '2' },
  { id: 'owners', name: 'Owners', kinds: [], color: '#f2c14e', key: '3' },
] as const satisfies readonly Overlay[]

export type OverlayId = (typeof OVERLAYS)[number]['id']

// The overlays after a key press: an overlay's digit toggles it, 0 switches
// every overlay off. Undefined for any other key.
export function resolveOverlayKey(
  overlays: ReadonlySet<OverlayId>,
  key: string,
): ReadonlySet<OverlayId> | undefined {
  if (key === '0') return new Set()
  const overlay = OVERLAYS.find((candidate) => candidate.key === key)
  if (!overlay) return undefined
  const next = new Set(overlays)
  if (!next.delete(overlay.id)) next.add(overlay.id)
  return next
}

// The kinds of line a frame drew, for the map legend.
export interface DrawnLines {
  // The overlays whose lines are drawn.
  overlays: readonly OverlayId[]
  // The selection's lines are drawn, coloured by direction.
  isDirected: boolean
  // A selection's outline is drawn.
  isSelected: boolean
}

// Named in the overlay menu, not built yet.
export const PLANNED_OVERLAYS = ['Calls', 'HTTP requests'] as const
