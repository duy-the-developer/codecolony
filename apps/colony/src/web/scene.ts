import { logError } from '../shared/log.ts'
import {
  symbolCountOf,
  symbolsFromRows,
  symbolsKeyOf,
  type WorldState,
} from '../shared/world-decoder.ts'
import type { Edge, SymbolRow, SymbolsResponse, World, WorldNode } from '../shared/world-types.ts'

// Lookup structures over one world version: the one place the page reads
// world data from. The server sends the world without symbols; a file's
// symbols are loaded when it opens (loadSymbols) and then join byId and
// children like any other node. Until then an edge that ends on one of them
// is held by its file.

// Where a scene gets the symbols it was sent without.
export interface SymbolSource {
  state: WorldState
  fetchSymbols(version: number, files: readonly number[]): Promise<SymbolsResponse | undefined>
}

// Files per symbols request, as /api/symbols allows.
const MAX_SYMBOL_FILES = 500

export class Scene {
  readonly byId = new Map<string, WorldNode>()
  readonly children = new Map<string, WorldNode[]>()
  readonly root: WorldNode | undefined
  edges: Edge[]
  readonly world: World
  // Grows each time symbols arrive.
  revision = 0
  private readonly source: SymbolSource | undefined
  // File id -> index in the source's rows.
  private readonly indexOf = new Map<string, number>()
  // File id -> its symbols as sent, once loaded.
  private readonly symbolRows = new Map<string, readonly SymbolRow[]>()
  private readonly symbolNodes = new Map<string, WorldNode[]>()
  private readonly loading = new Set<string>()
  private readonly listeners = new Set<() => void>()
  // File id -> ids of its symbols that edges end on.
  private symbolRefs: Map<string, string[]> | undefined

  // previous: the scene this one replaces; files whose symbols did not change
  // keep them without asking the server again.
  constructor(world: World, source?: SymbolSource, previous?: Scene) {
    this.world = world
    this.source = source
    world.nodes.forEach((node, index) => {
      this.byId.set(node.id, node)
      if (source && symbolCountOf(source.state, index) > 0) {
        this.indexOf.set(node.id, index)
        if (!this.children.has(node.id)) this.children.set(node.id, [])
      }
      if (!node.parent) return
      const list = this.children.get(node.parent)
      if (list) list.push(node)
      else this.children.set(node.parent, [node])
    })
    this.root = world.nodes.find((node) => node.kind === 'world')
    this.edges = world.edges
    if (previous && source) {
      for (const [id, rows] of previous.symbolRows) {
        const index = this.indexOf.get(id)
        const before = previous.indexOf.get(id)
        if (index === undefined || before === undefined || !previous.source) continue
        if (symbolsKeyOf(source.state, index) !== symbolsKeyOf(previous.source.state, before))
          continue
        this.addSymbols(id, rows)
      }
    }
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

  // The ids of a node and everything inside it, including the symbols that
  // edges end on in files whose symbols are not loaded yet.
  listSubtree(node: WorldNode): Set<string> {
    const subtree = new Set<string>()
    const stack = [node]
    for (let n = stack.pop(); n; n = stack.pop()) {
      subtree.add(n.id)
      stack.push(...(this.children.get(n.id) ?? []))
      if (n.kind === 'file' && this.needsSymbols(n)) {
        for (const id of this.listSymbolRefs().get(n.id) ?? []) subtree.add(id)
      }
    }
    return subtree
  }

  // A file's loaded symbols, nested ones included, in world order.
  listSymbols(file: WorldNode): WorldNode[] {
    const loaded = this.symbolNodes.get(file.id)
    if (loaded) return loaded
    const symbols: WorldNode[] = []
    const stack = [...(this.children.get(file.id) ?? [])]
    for (let n = stack.pop(); n; n = stack.pop()) {
      if (n.kind !== 'symbol') continue
      symbols.push(n)
      stack.push(...(this.children.get(n.id) ?? []))
    }
    return symbols.sort((a, b) => this.world.nodes.indexOf(a) - this.world.nodes.indexOf(b))
  }

  // The file a symbol id belongs to, whether or not its symbols are loaded.
  fileIdOf(id: string): string | undefined {
    for (let at = id.indexOf('#'); at >= 0; at = id.indexOf('#', at + 1)) {
      const prefix = id.slice(0, at)
      if (this.byId.get(prefix)?.kind === 'file') return prefix
    }
    return undefined
  }

  // True for a file whose symbols the server still has to send.
  needsSymbols(node: WorldNode): boolean {
    return this.indexOf.has(node.id) && !this.symbolRows.has(node.id)
  }

  // Asks the server for the symbols of these files, once each.
  async loadSymbols(files: readonly WorldNode[]): Promise<void> {
    const source = this.source
    if (!source) return
    const wanted = files.filter((file) => this.needsSymbols(file) && !this.loading.has(file.id))
    for (let i = 0; i < wanted.length; i += MAX_SYMBOL_FILES) {
      const batch = wanted.slice(i, i + MAX_SYMBOL_FILES)
      for (const file of batch) this.loading.add(file.id)
      const indices = batch.map((file) => this.indexOf.get(file.id) as number)
      try {
        const response = await source.fetchSymbols(this.world.version, indices)
        if (!response) continue
        batch.forEach((file, b) => {
          const rows = response.files[indices[b] as number]
          if (rows) this.addSymbols(file.id, rows)
        })
        this.revision++
        for (const listener of this.listeners) listener()
      } catch (error) {
        logError('Could not load symbols', { error })
      } finally {
        for (const file of batch) this.loading.delete(file.id)
      }
    }
  }

  // The node with this id, loading its file's symbols first if it is one of
  // them.
  async ensureNode(id: string): Promise<WorldNode | undefined> {
    const known = this.byId.get(id)
    if (known) return known
    const file = this.byId.get(this.fileIdOf(id) ?? '')
    if (file) await this.loadSymbols([file])
    return this.byId.get(id)
  }

  // Calls listener whenever symbols arrive; returns the unsubscribe.
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Adds edges proven later (deep index); an LSP edge replaces a weaker one
  // between the same nodes.
  mergeEdges(extra: Edge[]): void {
    const key = (e: Edge) => `${e.kind}|${e.from}|${e.to}`
    const incoming = new Map(extra.map((e) => [key(e), e]))
    this.edges = [...this.edges.filter((e) => !incoming.has(key(e))), ...incoming.values()]
    this.symbolRefs = undefined
  }

  private addSymbols(fileId: string, rows: readonly SymbolRow[]): void {
    const file = this.byId.get(fileId)
    if (!file || this.symbolRows.has(fileId)) return
    this.symbolRows.set(fileId, rows)
    const symbols = symbolsFromRows(file, rows)
    this.symbolNodes.set(fileId, symbols)
    for (const symbol of symbols) {
      this.byId.set(symbol.id, symbol)
      const parent = symbol.parent ?? fileId
      const list = this.children.get(parent)
      if (list) list.push(symbol)
      else this.children.set(parent, [symbol])
    }
  }

  private listSymbolRefs(): Map<string, string[]> {
    if (this.symbolRefs) return this.symbolRefs
    const refs = new Map<string, string[]>()
    const seen = new Set<string>()
    for (const edge of this.edges) {
      for (const id of [edge.from, edge.to]) {
        if (seen.has(id) || this.byId.has(id)) continue
        seen.add(id)
        const file = this.fileIdOf(id)
        if (!file) continue
        const list = refs.get(file)
        if (list) list.push(id)
        else refs.set(file, [id])
      }
    }
    this.symbolRefs = refs
    return refs
  }
}
