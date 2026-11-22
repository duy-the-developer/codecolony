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

// True when an edge from one id to the other enters or leaves a focused node.
export function crossesFocus(focus: Focus, from: string, to: string): boolean {
  return focus.subtrees.some((subtree) => subtree.has(from) !== subtree.has(to))
}
