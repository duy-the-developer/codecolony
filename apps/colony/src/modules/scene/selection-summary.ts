import type { WorldNode } from '../world/world-types.ts'
import { type EdgeSection, listEdgeSections } from './edge-sections.ts'
import type { Scene } from './scene.ts'

// The inspector's combined view of several selected nodes: what they hold
// together and how they connect, to each other and to the rest of the map.

export interface SelectionSummary {
  // Files inside the selection, each counted once even when selected nodes
  // overlap.
  files: number
  // Imports from one selected node into another.
  importsBetween: number
  // Imports from the selection to the rest of the map, and back.
  importsOut: number
  importedBy: number
  // Every edge in or out of the selection as a whole.
  sections: EdgeSection[]
}

export function buildSelectionSummary(scene: Scene, nodes: readonly WorldNode[]): SelectionSummary {
  const subtrees = nodes.map((node) => scene.listSubtree(node))
  const all = new Set(subtrees.flatMap((subtree) => [...subtree]))
  let files = 0
  for (const id of all) if (scene.byId.get(id)?.kind === 'file') files++
  let importsBetween = 0
  let importsOut = 0
  let importedBy = 0
  for (const edge of scene.edges) {
    if (edge.kind !== 'import') continue
    const fromInside = all.has(edge.from)
    const toInside = all.has(edge.to)
    if (fromInside && toInside) {
      if (subtrees.some((subtree) => subtree.has(edge.from) !== subtree.has(edge.to)))
        importsBetween++
    } else if (fromInside) {
      importsOut++
    } else if (toInside) {
      importedBy++
    }
  }
  return {
    files,
    importsBetween,
    importsOut,
    importedBy,
    sections: listEdgeSections(scene, all),
  }
}
