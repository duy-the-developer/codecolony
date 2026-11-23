import type { RouteNode } from '../../lane-routing/route-boxes.ts'
import type { Scene } from '../../scene/scene.ts'
import type { WorldNode } from '../../world/world-types.ts'
import { DEPENDANT, DEPENDS_ON, type Focus, focusDirection } from '../focus.ts'
import { LinkCache } from '../link-cache.ts'
import { MIN_VISIBLE_PX, openness } from '../lod.ts'
import type { LaneRouterHandle } from './lane-router.ts'
import type { FileLines, LaneEdge, LaneRoutes } from './lane-world.ts'

// The Dependency overlay's lines for one scene, frame by frame. Every line
// runs from an importing file to the file it imports, and is routed once
// from the layout (lane-world.ts), in the worker, as soon as the scene loads,
// and kept: the camera never changes a line. Zoomed out, a line fades with
// the fainter of its two files, as they fade into their closed module. With
// the overlay on, every line is drawn; with it off, only those of the hovered
// or selected nodes.

export interface LaneFrame {
  // Every line, with the overlay on.
  all: LaneRoutes | undefined
  // Per link of all, the focus.ts direction bits of the focus's imports it
  // carries, 0 for none; undefined when nothing in focus has such a link.
  hot: Uint8Array | undefined
  // With the overlay off, the lines of which only those with direction bits
  // in focusHot show.
  focus: LaneRoutes | undefined
  focusHot: Uint8Array | undefined
  // How much each line shows at this scale, by its fade group.
  fade: LaneFade | undefined
  // Drawn nodes at the other end of the focus's imports, by id, with the
  // direction bits of the imports that reach them.
  partners: ReadonlyMap<string, number>
}

export interface LaneFade {
  // Per link, its fade group: the lines between files in the same two
  // folders, which fade together.
  groups: Int32Array
  // Per group, the alpha of the fainter end file, 0 when one is not drawn.
  alpha: Float32Array
}

interface Holder {
  readonly node: WorldNode
}

let versions = 0

export class LaneLayer {
  private readonly router: LaneRouterHandle
  private readonly onChange: () => void
  private readonly version = ++versions
  private readonly scene: Scene
  private readonly links: LinkCache
  // The scene's import edges, in the order the worker has them.
  private readonly edges: LaneEdge[] = []
  private lines: FileLines | undefined
  private isBusy = false
  // Per fade group, the folders holding its files, from then to.
  private groups: Int32Array = new Int32Array(0)
  private groupEnds: [from: string, to: string][] = []
  private fade: { scale: number; fade: LaneFade } | undefined
  private hot: { focus: Focus; links: Uint8Array | undefined } | undefined

  constructor(scene: Scene, router: LaneRouterHandle, onChange: () => void) {
    this.router = router
    this.onChange = onChange
    this.scene = scene
    this.links = new LinkCache(scene)
    for (const edge of scene.edges)
      if (edge.kind === 'import') this.edges.push([edge.from, edge.to])
    const nodes: RouteNode[] = []
    for (const node of scene.world.nodes) {
      if (node.kind === 'symbol') continue
      const { id, kind, rect, name } = node
      nodes.push(
        node.parent ? { id, parent: node.parent, kind, rect, name } : { id, kind, rect, name },
      )
    }
    router.loadWorld(this.version, nodes, this.edges)
  }

  // The lines to draw at this scale. holders: the drawn nodes that can hold
  // a link end; focus: the hovered or selected nodes, if any.
  frame(scale: number, holders: readonly Holder[], focus: Focus, isOverlayOn: boolean): LaneFrame {
    const frame: LaneFrame = {
      all: undefined,
      hot: undefined,
      focus: undefined,
      focusHot: undefined,
      fade: undefined,
      partners: new Map(),
    }
    const hasFocus = focus.ids.length > 0
    if (!this.lines) {
      this.requestLines()
    } else if (isOverlayOn || hasFocus) {
      const { routes } = this.lines
      const hot = hasFocus ? this.listHot(focus) : undefined
      if (isOverlayOn) {
        frame.all = routes
        frame.hot = hot
      } else if (hot) {
        frame.focus = routes
        frame.focusHot = hot
      }
      if (frame.all || frame.focus) frame.fade = this.resolveFade(scale)
    }

    if (hasFocus) {
      const partners = new Map<string, number>()
      const links = this.links.listLinks(scale, holders, focus.all)
      const mark = (id: string | undefined, direction: number) => {
        if (id && !focus.all.has(id)) partners.set(id, (partners.get(id) ?? 0) | direction)
      }
      for (let r = 0; r < links.count; r++) {
        if (!links.hot[r] || links.kind[r] !== 'import') continue
        // The focus imports what a link leads to, and is imported by where it
        // starts.
        mark(holders[links.from[r] as number]?.node.id, DEPENDANT)
        mark(holders[links.to[r] as number]?.node.id, DEPENDS_ON)
      }
      frame.partners = partners
    }
    return frame
  }

  // How much each fade group shows at this scale: the alpha the renderer
  // gives the files in its folders, wherever they are, so panning changes
  // nothing.
  private resolveFade(scale: number): LaneFade {
    if (this.fade?.scale === scale) return this.fade.fade
    const shown = new Map<string, number>()
    // The alpha a node's children are drawn with, as render.ts works it out:
    // 0 when the node is too small to draw or shows no children.
    const kidAlpha = (id: string): number => {
      const known = shown.get(id)
      if (known !== undefined) return known
      const node = this.scene.byId.get(id)
      let alpha = 0
      if (node) {
        const side = Math.min(node.rect.w, node.rect.h) * scale
        const own = node.parent === undefined ? 1 : kidAlpha(node.parent)
        const open = openness(node.kind, side)
        if ((node.kind === 'world' || side >= MIN_VISIBLE_PX) && open > 0.01) alpha = own * open
      }
      shown.set(id, alpha)
      return alpha
    }
    const alpha = new Float32Array(this.groupEnds.length)
    this.groupEnds.forEach(([from, to], g) => {
      alpha[g] = Math.min(kidAlpha(from), kidAlpha(to))
    })
    const fade = { groups: this.groups, alpha }
    this.fade = { scale, fade }
    return fade
  }

  // Each line's fade group, by the folders that hold its two files.
  private groupLines(lines: FileLines): void {
    const index = new Map<string, number>()
    this.groupEnds = []
    this.groups = Int32Array.from(lines.links, ({ from, to }) => {
      const a = this.scene.byId.get(from)?.parent ?? ''
      const b = this.scene.byId.get(to)?.parent ?? ''
      const key = `${a}\n${b}`
      let g = index.get(key)
      if (g === undefined) {
        g = this.groupEnds.push([a, b]) - 1
        index.set(key, g)
      }
      return g
    })
  }

  // Which way each line carries imports into or out of a focused node, or
  // undefined when none does. Imports inside one are left out, as in the
  // inspector; imports between two focused nodes count.
  private listHot(focus: Focus): Uint8Array | undefined {
    if (this.hot?.focus === focus) return this.hot.links
    const { links: all, edgeOffsets, edges } = this.lines as FileLines
    let links: Uint8Array | undefined
    for (let i = 0; i < all.length; i++) {
      let direction = 0
      for (let k = edgeOffsets[i] as number; k < (edgeOffsets[i + 1] as number); k++) {
        const [from, to] = this.edges[edges[k] as number] as LaneEdge
        direction |= focusDirection(focus, from, to)
      }
      if (direction === 0) continue
      links ??= new Uint8Array(all.length)
      links[i] = direction
    }
    this.hot = { focus, links }
    return links
  }

  // Asks the worker for the lines once; a stale or failed answer is asked
  // for again on the next frame.
  private requestLines(): void {
    if (this.isBusy) return
    this.isBusy = true
    this.router.routeFiles(this.version).then(
      (lines) => {
        this.isBusy = false
        this.groupLines(lines)
        this.lines = lines
        this.onChange()
      },
      () => {
        this.isBusy = false
      },
    )
  }
}
