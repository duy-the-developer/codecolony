import type { Edge, World, WorldNode } from '../shared/world-types.ts'

// Lookup structures over one world version.

export class Scene {
  readonly byId = new Map<string, WorldNode>()
  readonly children = new Map<string, WorldNode[]>()
  readonly root: WorldNode | undefined
  edges: Edge[]

  constructor(readonly world: World) {
    for (const node of world.nodes) {
      this.byId.set(node.id, node)
      if (!node.parent) continue
      const list = this.children.get(node.parent)
      if (list) list.push(node)
      else this.children.set(node.parent, [node])
    }
    this.root = world.nodes.find((node) => node.kind === 'world')
    this.edges = world.edges
  }

  parentOf(node: WorldNode): WorldNode | undefined {
    return node.parent ? this.byId.get(node.parent) : undefined
  }

  isAncestor(ancestor: string, node: string): boolean {
    for (let n = this.byId.get(node); n; n = this.parentOf(n)) {
      if (n.parent === ancestor) return true
    }
    return false
  }

  // The node and its ancestors below the world, outermost first.
  listAncestry(node: WorldNode): WorldNode[] {
    const chain: WorldNode[] = []
    for (let n: WorldNode | undefined = node; n && n.kind !== 'world'; n = this.parentOf(n)) {
      chain.unshift(n)
    }
    return chain
  }

  // The repository a node belongs to.
  repoOf(node: WorldNode): WorldNode | undefined {
    for (let n: WorldNode | undefined = node; n; n = this.parentOf(n)) {
      if (n.kind === 'repo') return n
    }
    return undefined
  }

  // Adds edges proven later (deep index); an LSP edge replaces a weaker one
  // between the same nodes.
  mergeEdges(extra: Edge[]): void {
    const key = (e: Edge) => `${e.kind}|${e.from}|${e.to}`
    const incoming = new Map(extra.map((e) => [key(e), e]))
    this.edges = [...this.edges.filter((e) => !incoming.has(key(e))), ...incoming.values()]
  }
}
