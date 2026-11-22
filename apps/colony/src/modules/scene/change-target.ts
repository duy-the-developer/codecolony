import type { WorldNode } from '../world/world-types.ts'
import type { Scene } from './scene.ts'

// Where to look on the map for a set of changed files: the smallest node that
// holds them all. A file not on the map yet (new, or not indexed) counts as
// its nearest folder that is.

export interface ChangeSet {
  // The project on the map, and the repository inside it.
  project: string
  repo: string
  // Repository-relative paths.
  paths: readonly string[]
}

export function findChangeTarget(scene: Scene, changes: ChangeSet): WorldNode | undefined {
  const repo = findRepo(scene, changes)
  if (!repo || changes.paths.length === 0) return undefined
  const folders = listFolders(scene, repo)
  const nodes = changes.paths.map((path) => {
    const file = scene.byId.get(`${repo.id}/${path}`)
    if (file) return file
    for (let dir = parentPath(path); dir; dir = parentPath(dir)) {
      const folder = folders.get(dir)
      if (folder) return folder
    }
    return repo
  })
  return commonAncestor(scene, nodes)
}

function findRepo(scene: Scene, { project, repo }: ChangeSet): WorldNode | undefined {
  const projectNode = [...scene.byId.values()].find(
    (node) => node.kind === 'project' && node.name === project,
  )
  const repos = (projectNode && scene.children.get(projectNode.id)) ?? []
  const [only] = repos
  return repos.find((node) => node.name === repo) ?? (repos.length === 1 ? only : undefined)
}

// Packages and modules by their repository-relative path.
function listFolders(scene: Scene, repo: WorldNode): Map<string, WorldNode> {
  const folders = new Map<string, WorldNode>()
  const stack = [...(scene.children.get(repo.id) ?? [])]
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.kind !== 'package' && node.kind !== 'module') continue
    if (node.path !== undefined) folders.set(node.path, node)
    stack.push(...(scene.children.get(node.id) ?? []))
  }
  return folders
}

function commonAncestor(scene: Scene, nodes: readonly WorldNode[]): WorldNode | undefined {
  const [first, ...rest] = nodes.map((node) => scene.listAncestry(node))
  if (!first) return undefined
  let depth = first.length
  for (const chain of rest) {
    let shared = 0
    while (shared < Math.min(depth, chain.length) && chain[shared] === first[shared]) shared++
    depth = shared
  }
  return first[depth - 1]
}

function parentPath(path: string): string {
  const at = path.lastIndexOf('/')
  return at > 0 ? path.slice(0, at) : ''
}
