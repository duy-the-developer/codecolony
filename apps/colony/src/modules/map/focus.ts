import type { Scene } from '../scene/scene.ts'

// The nodes whose connections stand out, each with its subtree. A link is the
// focus's when it crosses the edge of any one of those subtrees, so links
// between two selected nodes show too.
export interface Focus {
  // The ids joined, the same for the same nodes in the same order.
  readonly key: string
  readonly ids: readonly string[]
  readonly subtrees: readonly ReadonlySet<string>[]
  // Every subtree together.
  readonly all: ReadonlySet<string>
}

export const NO_FOCUS: Focus = { key: '', ids: [], subtrees: [], all: new Set() }

// Ids not on the map are left out.
export function buildFocus(scene: Scene, ids: readonly string[]): Focus {
  const nodes = ids.flatMap((id) => scene.byId.get(id) ?? [])
  if (nodes.length === 0) return NO_FOCUS
  const subtrees = nodes.map((node) => scene.listSubtree(node))
  const [first] = subtrees
  const all = subtrees.length === 1 && first ? first : new Set(subtrees.flatMap((s) => [...s]))
  const kept = nodes.map((node) => node.id)
  return { key: kept.join('\n'), ids: kept, subtrees, all }
}

// Which way an edge runs relative to the focus, as bits: DEPENDS_ON when it
// leaves a focused node (the focus imports across it), DEPENDANT when it
// enters one (it imports the focus). An edge between two focused nodes is
// both; one inside a single focused node or outside all of them is 0.
export const DEPENDS_ON = 1
export const DEPENDANT = 2

export function focusDirection(focus: Focus, from: string, to: string): number {
  let direction = 0
  for (const subtree of focus.subtrees) {
    const hasFrom = subtree.has(from)
    if (hasFrom === subtree.has(to)) continue
    direction |= hasFrom ? DEPENDS_ON : DEPENDANT
  }
  return direction
}
