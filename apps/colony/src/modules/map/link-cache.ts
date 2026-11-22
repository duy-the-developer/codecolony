import type { Scene } from '../scene/scene.ts'
import { PROVEN_PROVENANCES } from '../world/facts.ts'
import type { Edge, EdgeKind, WorldNode } from '../world/world-types.ts'
import { MIN_VISIBLE_PX, openness } from './lod.ts'

// Links join the deepest drawn nodes that hold each edge's ends, so they merge
// as you zoom out and split as you zoom in. Working that out walks every edge,
// which is far too slow to do on every frame of a large world, so it happens in
// two steps:
//
// 1. Once per zoom level, every edge is merged into a link between the deepest
//    nodes visible at that level, as if the whole world were on screen. A level
//    spans a quarter of an octave of scale and uses the nodes visible at its
//    highest scale, which include every node visible anywhere in the level.
// 2. Every frame, each end moves up to its deepest ancestor that is drawn, so
//    the links end on the same nodes as an edge-by-edge walk would. A link
//    survives only if the two children of its ends' common ancestor are both
//    drawn; otherwise one end would land on an ancestor of the other. That check
//    is two array reads, so off-screen links cost almost nothing.

export const LINK_LEVELS_PER_OCTAVE = 4
// Nodes this faint are drawn, but links pass them to their parent.
export const MIN_LINK_ALPHA = 0.25
// Levels kept in memory; zooming back and forth reuses them.
const MAX_CACHED_LEVELS = 16
// How far a node's children must fade in before they are visited at all.
const MIN_OPEN = 0.01

// The links of one zoom level, between node indices into LinkCache.nodes.
interface LevelLinks {
  readonly count: number
  readonly from: Int32Array
  readonly to: Int32Array
  // Edge kind index * 2, plus 1 when proven.
  readonly code: Int32Array
  // How many edges merged into each link.
  readonly edges: Int32Array
  // The children of the common ancestor of from and to, on each side.
  readonly fromTop: Int32Array
  readonly toTop: Int32Array
  // The link each edge was merged into, or -1.
  readonly linkOfEdge: Int32Array
  // The containers holding folders that show their children at this level,
  // and a key that is the same for every level with the same ones.
  readonly open: OpenContainers
}

export interface OpenContainers {
  readonly key: string
  readonly ids: readonly string[]
}

// The links to draw this frame. Backed by scratch space: valid until the next
// call to LinkCache.listLinks.
export interface FrameLinks {
  readonly count: number
  // Positions in the holders passed to LinkCache.listLinks.
  readonly from: Int32Array
  readonly to: Int32Array
  readonly kind: readonly EdgeKind[]
  readonly proven: Uint8Array
  // How many edges merged into each link.
  readonly edges: Int32Array
  // Carries an edge that touches the selection.
  readonly hot: Uint8Array
  // Both ends are symbols in the same file.
  readonly sameFile: Uint8Array
}

export class LinkCache {
  // Nodes reachable from the world root, parents before children.
  private readonly nodes: WorldNode[] = []
  private readonly parent: Int32Array
  private readonly depth: Int32Array
  private readonly side: Float64Array
  private readonly hasKids: Uint8Array
  // Holds a folder or larger: whether it is open decides lane blocks.
  private readonly hasFolders: Uint8Array
  // For a symbol, the file that holds it; otherwise -1.
  private readonly fileOf: Int32Array
  private readonly index = new Map<string, number>()
  private edges: Edge[] = []
  private edgeFrom = new Int32Array(0)
  private edgeTo = new Int32Array(0)
  private edgeCode = new Int32Array(0)
  private kinds: EdgeKind[] = []
  private readonly levels = new Map<number, LevelLinks>()
  private hotSubtree: ReadonlySet<string> | undefined
  private edgeHot = new Uint8Array(0)
  private hotLinks = new WeakMap<LevelLinks, Uint8Array>()
  // Scratch space sized to the nodes, reused by every level build.
  private visible = new Uint8Array(0)
  private visited = new Uint8Array(0)
  private alpha = new Float64Array(0)
  private open = new Float64Array(0)
  // Scratch space sized to the edges, shared by level builds and frames: a
  // level has at most one link per edge, a frame at most one per level link.
  private linkFrom = new Int32Array(0)
  private linkTo = new Int32Array(0)
  private linkCode = new Int32Array(0)
  private linkEdges = new Int32Array(0)
  private linkHot = new Uint8Array(0)
  private linkProven = new Uint8Array(0)
  private linkSameFile = new Uint8Array(0)
  private readonly linkKind: EdgeKind[] = []
  // Open-addressing table over the link arrays; a slot holds link index + 1.
  private slots = new Int32Array(0)
  // Holds the frame number on the nodes drawn in that frame, and their
  // position in that frame's holders.
  private readonly onScreen: Int32Array
  private readonly holderAt: Int32Array
  private frame = 0

  private readonly scene: Scene

  constructor(scene: Scene) {
    this.scene = scene
    if (scene.root) this.nodes.push(scene.root)
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i] as WorldNode
      this.index.set(node.id, i)
      for (const kid of scene.children.get(node.id) ?? []) this.nodes.push(kid)
    }
    const n = this.nodes.length
    this.parent = new Int32Array(n)
    this.depth = new Int32Array(n)
    this.side = new Float64Array(n)
    this.hasKids = new Uint8Array(n)
    this.hasFolders = new Uint8Array(n)
    this.fileOf = new Int32Array(n)
    this.onScreen = new Int32Array(n)
    this.holderAt = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i] as WorldNode
      const p = i === 0 ? -1 : (this.index.get(node.parent ?? '') ?? -1)
      this.parent[i] = p
      this.depth[i] = p < 0 ? 0 : (this.depth[p] as number) + 1
      this.side[i] = Math.min(node.rect.w, node.rect.h)
      this.hasKids[i] = scene.children.has(node.id) ? 1 : 0
      this.hasFolders[i] = scene.children
        .get(node.id)
        ?.some((kid) => kid.kind !== 'file' && kid.kind !== 'symbol')
        ? 1
        : 0
      this.fileOf[i] =
        node.kind !== 'symbol' || p < 0
          ? -1
          : this.nodes[p]?.kind === 'file'
            ? p
            : (this.fileOf[p] as number)
    }
  }

  // The links between the nodes drawn at this scale. holders are the drawn
  // nodes with at least MIN_LINK_ALPHA.
  listLinks(
    scale: number,
    holders: readonly { readonly node: WorldNode }[],
    subtree: ReadonlySet<string>,
  ): FrameLinks {
    const level = this.resolveLevel(scale)
    const levelHot = this.listHotLinks(level, subtree)
    const { onScreen, parent, linkFrom: from, linkTo: to, linkCode: code } = this
    const { linkEdges: edges, linkHot: hot, linkProven: proven, linkSameFile: sameFile } = this
    const { holderAt } = this
    const frame = ++this.frame
    holders.forEach(({ node }, position) => {
      const i = this.index.get(node.id)
      if (i === undefined) return
      onScreen[i] = frame
      holderAt[i] = position
    })
    const deepestOnScreen = (start: number): number => {
      let i = start
      while (onScreen[i] !== frame) i = parent[i] as number
      return i
    }
    this.slots.fill(0)
    let count = 0
    for (let r = 0; r < level.count; r++) {
      if (onScreen[level.fromTop[r] as number] !== frame) continue
      if (onScreen[level.toTop[r] as number] !== frame) continue
      const a = deepestOnScreen(level.from[r] as number)
      const b = deepestOnScreen(level.to[r] as number)
      const link = this.findLink(a, b, level.code[r] as number, count)
      if (link === count) {
        count++
        edges[link] = 0
        hot[link] = 0
      }
      edges[link] = (edges[link] as number) + (level.edges[r] as number)
      if (levelHot[r]) hot[link] = 1
    }

    const kind = this.linkKind
    kind.length = count
    for (let r = 0; r < count; r++) {
      const c = code[r] as number
      kind[r] = this.kinds[c >> 1] as EdgeKind
      proven[r] = c & 1
      const file = this.fileOf[from[r] as number] as number
      sameFile[r] = file >= 0 && file === this.fileOf[to[r] as number] ? 1 : 0
      from[r] = holderAt[from[r] as number] as number
      to[r] = holderAt[to[r] as number] as number
    }
    return { count, from, to, kind, proven, edges, hot, sameFile }
  }

  // The containers open at the level a scale falls in.
  listOpenContainers(scale: number): OpenContainers {
    return this.resolveLevel(scale).open
  }

  // The links of the level a scale falls in, aggregated on first use.
  private resolveLevel(scale: number): LevelLinks {
    if (this.scene.edges !== this.edges) this.indexEdges()
    const level = Math.floor(Math.log2(scale) * LINK_LEVELS_PER_OCTAVE)
    let links = this.levels.get(level)
    if (links) {
      this.levels.delete(level)
    } else {
      // Rounding slack, so the level never misses a node visible at `scale`.
      links = this.buildLevel(2 ** ((level + 1) / LINK_LEVELS_PER_OCTAVE) * (1 + 1e-9))
      if (this.levels.size >= MAX_CACHED_LEVELS) {
        const oldest = this.levels.keys().next().value
        if (oldest !== undefined) this.levels.delete(oldest)
      }
    }
    this.levels.set(level, links)
    return links
  }

  // Which level links carry an edge touching the selection.
  private listHotLinks(links: LevelLinks, subtree: ReadonlySet<string>): Uint8Array {
    if (subtree !== this.hotSubtree) {
      this.hotSubtree = subtree
      this.hotLinks = new WeakMap()
      this.edgeHot = new Uint8Array(this.edges.length)
      if (subtree.size > 0) {
        this.edges.forEach((edge, e) => {
          if (subtree.has(edge.from) || subtree.has(edge.to)) this.edgeHot[e] = 1
        })
      }
    }
    let hot = this.hotLinks.get(links)
    if (!hot) {
      hot = new Uint8Array(links.count)
      for (let e = 0; e < this.edges.length; e++) {
        const link = links.linkOfEdge[e] as number
        if (link >= 0 && this.edgeHot[e]) hot[link] = 1
      }
      this.hotLinks.set(links, hot)
    }
    return hot
  }

  private indexEdges(): void {
    this.edges = this.scene.edges
    this.levels.clear()
    this.hotSubtree = undefined
    const count = this.edges.length
    this.edgeFrom = new Int32Array(count)
    this.edgeTo = new Int32Array(count)
    this.edgeCode = new Int32Array(count)
    this.kinds = []
    for (let e = 0; e < count; e++) {
      const edge = this.edges[e] as Edge
      this.edgeFrom[e] = this.indexOfEnd(edge.from)
      this.edgeTo[e] = this.indexOfEnd(edge.to)
      let kind = this.kinds.indexOf(edge.kind)
      if (kind < 0) kind = this.kinds.push(edge.kind) - 1
      this.edgeCode[e] = kind * 2 + (PROVEN_PROVENANCES.has(edge.provenance) ? 1 : 0)
    }
    this.linkFrom = new Int32Array(count)
    this.linkTo = new Int32Array(count)
    this.linkCode = new Int32Array(count)
    this.linkEdges = new Int32Array(count)
    this.linkHot = new Uint8Array(count)
    this.linkProven = new Uint8Array(count)
    this.linkSameFile = new Uint8Array(count)
    let size = 1
    while (size < count * 2) size *= 2
    this.slots = new Int32Array(size)
  }

  // An edge end's node; a symbol whose file's symbols are not loaded yet is
  // held by its file.
  private indexOfEnd(id: string): number {
    const index = this.index.get(id)
    if (index !== undefined) return index
    const file = this.scene.fileIdOf(id)
    return file === undefined ? -1 : (this.index.get(file) ?? -1)
  }

  // Which nodes the renderer draws at this scale with enough alpha to hold a
  // link, if the whole world were on screen.
  private listVisible(scale: number): Uint8Array {
    const n = this.nodes.length
    if (this.visible.length !== n) {
      this.visible = new Uint8Array(n)
      this.visited = new Uint8Array(n)
      this.alpha = new Float64Array(n)
      this.open = new Float64Array(n)
    }
    const { visible, visited, alpha, open } = this
    visible.fill(0)
    visited.fill(0)
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i] as WorldNode
      const p = this.parent[i] as number
      if (p < 0) {
        if (i !== 0) continue
        alpha[i] = 1
      } else {
        if (!visited[p] || (open[p] as number) <= MIN_OPEN) continue
        alpha[i] = (alpha[p] as number) * (open[p] as number)
      }
      const px = (this.side[i] as number) * scale
      if (node.kind !== 'world' && px < MIN_VISIBLE_PX) continue
      visited[i] = 1
      open[i] = this.hasKids[i] ? openness(node.kind, px) : 0
      if (node.kind !== 'world' && (alpha[i] as number) >= MIN_LINK_ALPHA) visible[i] = 1
    }
    return visible
  }

  private buildLevel(scale: number): LevelLinks {
    const visible = this.listVisible(scale)
    const { parent, depth, edgeFrom, edgeTo, edgeCode, linkEdges } = this
    const holder = (start: number): number => {
      let i = start
      while (i >= 0 && !visible[i]) i = parent[i] as number
      return i
    }
    // A container is open when a child shows. Only containers that hold
    // folders count: a module of files, or a file showing its symbols, is one
    // lane block either way.
    const isOpen = new Uint8Array(visible.length)
    for (let i = 0; i < visible.length; i++) {
      const p = parent[i] as number
      if (visible[i] && p >= 0 && this.hasFolders[p]) isOpen[p] = 1
    }
    const openIndices: number[] = []
    for (let i = 0; i < isOpen.length; i++) if (isOpen[i]) openIndices.push(i)
    const open = {
      key: openIndices.join(','),
      ids: openIndices.map((i) => (this.nodes[i] as WorldNode).id),
    }
    const edgeCount = this.edges.length
    const linkOfEdge = new Int32Array(edgeCount).fill(-1)
    const fromTop = new Int32Array(edgeCount)
    const toTop = new Int32Array(edgeCount)
    this.slots.fill(0)
    let count = 0
    for (let e = 0; e < edgeCount; e++) {
      const a = holder(edgeFrom[e] as number)
      const b = holder(edgeTo[e] as number)
      if (a < 0 || b < 0 || a === b) continue
      // Climb to the children of the common ancestor; meeting early means one
      // end holds the other, and such edges are not links.
      let ta = a
      let tb = b
      while ((depth[ta] as number) > (depth[tb] as number)) ta = parent[ta] as number
      while ((depth[tb] as number) > (depth[ta] as number)) tb = parent[tb] as number
      if (ta === tb) continue
      while (parent[ta] !== parent[tb]) {
        ta = parent[ta] as number
        tb = parent[tb] as number
      }
      const link = this.findLink(a, b, edgeCode[e] as number, count)
      if (link === count) {
        count++
        linkEdges[link] = 0
        fromTop[link] = ta
        toTop[link] = tb
      }
      linkEdges[link] = (linkEdges[link] as number) + 1
      linkOfEdge[e] = link
    }
    return {
      count,
      from: this.linkFrom.slice(0, count),
      to: this.linkTo.slice(0, count),
      code: this.linkCode.slice(0, count),
      edges: linkEdges.slice(0, count),
      fromTop: fromTop.slice(0, count),
      toTop: toTop.slice(0, count),
      linkOfEdge,
      open,
    }
  }

  // The link index of (a, b, code) in the scratch link arrays; when missing,
  // claims index `next` for it.
  private findLink(a: number, b: number, code: number, next: number): number {
    const { slots, linkFrom, linkTo, linkCode } = this
    const mask = slots.length - 1
    let slot =
      (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(code, 0xc2b2ae3d)) & mask
    for (;;) {
      const held = (slots[slot] as number) - 1
      if (held < 0) break
      if (linkFrom[held] === a && linkTo[held] === b && linkCode[held] === code) return held
      slot = (slot + 1) & mask
    }
    slots[slot] = next + 1
    linkFrom[next] = a
    linkTo[next] = b
    linkCode[next] = code
    return next
  }
}
