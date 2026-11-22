import type { WorldNode } from '../world/world-types.ts'
import type { Scene } from './scene.ts'

// The Files tab's tree: projects, repositories, folders and files, without
// symbols. A lone project or repository is skipped so the tree starts at its
// folders.

export function listTreeRoots(scene: Scene): WorldNode[] {
  let roots = scene.root ? listTreeChildren(scene, scene.root.id) : []
  while (
    roots.length === 1 &&
    roots[0] &&
    (roots[0].kind === 'project' || roots[0].kind === 'repo')
  ) {
    roots = listTreeChildren(scene, roots[0].id)
  }
  return roots
}

// Folders first, then files, each by name.
export function listTreeChildren(scene: Scene, id: string): WorldNode[] {
  return (scene.children.get(id) ?? [])
    .filter((node) => node.kind !== 'symbol')
    .sort((a, b) => kindOrder(a) - kindOrder(b) || a.name.localeCompare(b.name))
}

function kindOrder(node: WorldNode): number {
  return node.kind === 'file' ? 1 : 0
}
