import type { EdgeKind } from '../shared/world-types.ts'

// Overlays draw one kind of connection over the map. All are off by default:
// the map shows only blocks. With none on, hovering or selecting a node shows
// its connections from every overlay; with one on, all of its connections show
// and hovering a node highlights that node's.

export interface Overlay {
  id: string
  name: string
  // The edge kinds it draws.
  kinds: readonly EdgeKind[]
  color: string
}

export const OVERLAYS = [
  { id: 'dependency', name: 'Dependency', kinds: ['import'], color: '#6aa8ff' },
] as const satisfies readonly Overlay[]

export type OverlayId = (typeof OVERLAYS)[number]['id']

// Named in the overlay menu, not built yet.
export const PLANNED_OVERLAYS = ['Calls', 'HTTP requests'] as const
