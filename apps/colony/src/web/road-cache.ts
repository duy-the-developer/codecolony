import type { Edge, EdgeKind, Provenance, WorldNode } from '../shared/world-types.ts'
import { MIN_VISIBLE_PX, openness } from './lod.ts'
import type { Scene } from './scene.ts'

// Roads join the deepest drawn nodes that hold each edge's ends, so they merge
// as you zoom out and split as you zoom in. Working that out walks every edge,
// which is far too slow to do on every frame of a large world, so it happens in
// two steps:
//
// 1. Once per zoom level, every edge is merged into a road between the deepest
//    nodes visible at that level, as if the whole world were on screen. A level
//    spans a quarter of an octave of scale and uses the nodes visible at its
//    highest scale, which include every node visible anywhere in the level.
// 2. Every frame, each end moves up to its deepest ancestor that is drawn, so
//    the roads end on the same nodes as an edge-by-edge walk would. A road
//    survives only if the two children of its ends' common ancestor are both
//    drawn; otherwise one end would land on an ancestor of the other. That check
//    is two array reads, so off-screen roads cost almost nothing.

export const ROAD_LEVELS_PER_OCTAVE = 4
// Nodes this faint are drawn, but roads pass them to their parent.
export const MIN_ROAD_ALPHA = 0.25
// Levels kept in memory; zooming back and forth reuses them.
const MAX_CACHED_LEVELS = 16
// How far a node's children must fade in before they are visited at all.
const MIN_OPEN = 0.01

export const PROVEN_PROVENANCES: ReadonlySet<Provenance> = new Set(['lsp', 'tree-sitter'])

// The roads of one zoom level, between node indices into RoadCache.nodes.
interface LevelRoads {
  readonly count: number
  readonly from: Int32Array
  readonly to: Int32Array
  // Edge kind index * 2, plus 1 when proven.
  readonly code: Int32Array
  // How many edges merged into each road.
  readonly edges: Int32Array
  // The children of the common ancestor of from and to, on each side.
  readonly fromTop: Int32Array
  readonly toTop: Int32Array
  // The road each edge was merged into, or -1.
  readonly roadOfEdge: Int32Array
}

// The roads to draw this frame. Backed by scratch space: valid until the next
// call to RoadCache.listRoads.
export interface FrameRoads {
  readonly count: number
  // Positions in the holders passed to RoadCache.listRoads.
  readonly from: Int32Array
  readonly to: Int32Array
  readonly kind: readonly EdgeKind[]
  readonly proven: Uint8Array
  // How many edges merged into each road.
  readonly edges: Int32Array
  // Carries an edge that touches the selection.
  readonly hot: Uint8Array
  // Both ends are symbols in the same file.
  readonly sameFile: Uint8Array
}

export class RoadCache {
  // Nodes reachable from the world root, parents before children.
  private readonly nodes: WorldNode[] = []
  private readonly parent: Int32Array
  private readonly depth: Int32Array
  private readonly side: Float64Array
  private readonly hasKids: Uint8Array
  // For a symbol, the file that holds it; otherwise -1.
  private readonly fileOf: Int32Array
  private readonly index = new Map<string, number>()
  private edges: Edge[] = []
  private edgeFrom = new Int32Array(0)
  private edgeTo = new Int32Array(0)
  private edgeCode = new Int32Array(0)
  private kinds: EdgeKind[] = []
  private readonly levels = new Map<number, LevelRoads>()
  private hotSubtree: ReadonlySet<string> | undefined
  private edgeHot = new Uint8Array(0)
  private hotRoads = new WeakMap<LevelRoads, Uint8Array>()
  // Scratch space sized to the nodes, reused by every level build.
  private visible = new Uint8Array(0)
  private visited = new Uint8Array(0)
  private alpha = new Float64Array(0)
  private open = new Float64Array(0)
  // Scratch space sized to the edges, shared by level builds and frames: a
  // level has at most one road per edge, a frame at most one per level road.
  private roadFrom = new Int32Array(0)
  private roadTo = new Int32Array(0)
  private roadCode = new Int32Array(0)
  private roadEdges = new Int32Array(0)
  private roadHot = new Uint8Array(0)
  private roadProven = new Uint8Array(0)
  private roadSameFile = new Uint8Array(0)
  private readonly roadKind: EdgeKind[] = []
  // Open-addressing table over the road arrays; a slot holds road index + 1.
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
      this.fileOf[i] =
        node.kind !== 'symbol' || p < 0
          ? -1
          : this.nodes[p]?.kind === 'file'
            ? p
            : (this.fileOf[p] as number)
    }
  }

  // The roads between the nodes drawn at this scale. holders are the drawn
  // nodes with at least MIN_ROAD_ALPHA.
  listRoads(
    scale: number,
    holders: readonly { readonly node: WorldNode }[],
    subtree: ReadonlySet<string>,
  ): FrameRoads {
    const level = this.resolveLevel(scale)
    const levelHot = this.listHotRoads(level, subtree)
    const { onScreen, parent, roadFrom: from, roadTo: to, roadCode: code } = this
    const { roadEdges: edges, roadHot: hot, roadProven: proven, roadSameFile: sameFile } = this
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
      const road = this.findRoad(a, b, level.code[r] as number, count)
      if (road === count) {
        count++
        edges[road] = 0
        hot[road] = 0
      }
      edges[road] = (edges[road] as number) + (level.edges[r] as number)
      if (levelHot[r]) hot[road] = 1
    }

    const kind = this.roadKind
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

  // The roads of the level a scale falls in, aggregated on first use.
  private resolveLevel(scale: number): LevelRoads {
    if (this.scene.edges !== this.edges) this.indexEdges()
    const level = Math.floor(Math.log2(scale) * ROAD_LEVELS_PER_OCTAVE)
    let roads = this.levels.get(level)
    if (roads) {
      this.levels.delete(level)
    } else {
      // Rounding slack, so the level never misses a node visible at `scale`.
      roads = this.buildLevel(2 ** ((level + 1) / ROAD_LEVELS_PER_OCTAVE) * (1 + 1e-9))
      if (this.levels.size >= MAX_CACHED_LEVELS) {
        const oldest = this.levels.keys().next().value
        if (oldest !== undefined) this.levels.delete(oldest)
      }
    }
    this.levels.set(level, roads)
    return roads
  }

  // Which level roads carry an edge touching the selection.
  private listHotRoads(roads: LevelRoads, subtree: ReadonlySet<string>): Uint8Array {
    if (subtree !== this.hotSubtree) {
      this.hotSubtree = subtree
      this.hotRoads = new WeakMap()
      this.edgeHot = new Uint8Array(this.edges.length)
      if (subtree.size > 0) {
        this.edges.forEach((edge, e) => {
          if (subtree.has(edge.from) || subtree.has(edge.to)) this.edgeHot[e] = 1
        })
      }
    }
    let hot = this.hotRoads.get(roads)
    if (!hot) {
      hot = new Uint8Array(roads.count)
      for (let e = 0; e < this.edges.length; e++) {
        const road = roads.roadOfEdge[e] as number
        if (road >= 0 && this.edgeHot[e]) hot[road] = 1
      }
      this.hotRoads.set(roads, hot)
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
      this.edgeFrom[e] = this.index.get(edge.from) ?? -1
      this.edgeTo[e] = this.index.get(edge.to) ?? -1
      let kind = this.kinds.indexOf(edge.kind)
      if (kind < 0) kind = this.kinds.push(edge.kind) - 1
      this.edgeCode[e] = kind * 2 + (PROVEN_PROVENANCES.has(edge.provenance) ? 1 : 0)
    }
    this.roadFrom = new Int32Array(count)
    this.roadTo = new Int32Array(count)
    this.roadCode = new Int32Array(count)
    this.roadEdges = new Int32Array(count)
    this.roadHot = new Uint8Array(count)
    this.roadProven = new Uint8Array(count)
    this.roadSameFile = new Uint8Array(count)
    let size = 1
    while (size < count * 2) size *= 2
    this.slots = new Int32Array(size)
  }

  // Which nodes the renderer draws at this scale with enough alpha to hold a
  // road, if the whole world were on screen.
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
      if (node.kind !== 'world' && (alpha[i] as number) >= MIN_ROAD_ALPHA) visible[i] = 1
    }
    return visible
  }

  private buildLevel(scale: number): LevelRoads {
    const visible = this.listVisible(scale)
    const { parent, depth, edgeFrom, edgeTo, edgeCode, roadEdges } = this
    const holder = (start: number): number => {
      let i = start
      while (i >= 0 && !visible[i]) i = parent[i] as number
      return i
    }
    const edgeCount = this.edges.length
    const roadOfEdge = new Int32Array(edgeCount).fill(-1)
    const fromTop = new Int32Array(edgeCount)
    const toTop = new Int32Array(edgeCount)
    this.slots.fill(0)
    let count = 0
    for (let e = 0; e < edgeCount; e++) {
      const a = holder(edgeFrom[e] as number)
      const b = holder(edgeTo[e] as number)
      if (a < 0 || b < 0 || a === b) continue
      // Climb to the children of the common ancestor; meeting early means one
      // end holds the other, and such edges are not roads.
      let ta = a
      let tb = b
      while ((depth[ta] as number) > (depth[tb] as number)) ta = parent[ta] as number
      while ((depth[tb] as number) > (depth[ta] as number)) tb = parent[tb] as number
      if (ta === tb) continue
      while (parent[ta] !== parent[tb]) {
        ta = parent[ta] as number
        tb = parent[tb] as number
      }
      const road = this.findRoad(a, b, edgeCode[e] as number, count)
      if (road === count) {
        count++
        roadEdges[road] = 0
        fromTop[road] = ta
        toTop[road] = tb
      }
      roadEdges[road] = (roadEdges[road] as number) + 1
      roadOfEdge[e] = road
    }
    return {
      count,
      from: this.roadFrom.slice(0, count),
      to: this.roadTo.slice(0, count),
      code: this.roadCode.slice(0, count),
      edges: roadEdges.slice(0, count),
      fromTop: fromTop.slice(0, count),
      toTop: toTop.slice(0, count),
      roadOfEdge,
    }
  }

  // The road index of (a, b, code) in the scratch road arrays; when missing,
  // claims index `next` for it.
  private findRoad(a: number, b: number, code: number, next: number): number {
    const { slots, roadFrom, roadTo, roadCode } = this
    const mask = slots.length - 1
    let slot =
      (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(code, 0xc2b2ae3d)) & mask
    for (;;) {
      const held = (slots[slot] as number) - 1
      if (held < 0) break
      if (roadFrom[held] === a && roadTo[held] === b && roadCode[held] === code) return held
      slot = (slot + 1) & mask
    }
    slots[slot] = next + 1
    roadFrom[next] = a
    roadTo[next] = b
    roadCode[next] = code
    return next
  }
}
