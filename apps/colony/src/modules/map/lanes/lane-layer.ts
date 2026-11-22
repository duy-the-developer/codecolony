import { looseId, type RouteNode } from '../../lane-routing/route-boxes.ts'
import type { Scene } from '../../scene/scene.ts'
import type { WorldNode } from '../../world/world-types.ts'
import { DEPENDANT, DEPENDS_ON, type Focus, focusDirection } from '../focus.ts'
import { LINK_LEVELS_PER_OCTAVE, LinkCache } from '../link-cache.ts'
import { FILE_LANES_PX } from '../lod.ts'
import { clipHighways } from './clip-highways.ts'
import type { LaneRouterHandle } from './lane-router.ts'
import type { Highways, HolderRoutes, LaneEdge, LaneRoutes } from './lane-world.ts'

// The Dependency overlay's lanes for one scene, frame by frame. Every lane is
// routed once from the layout (lane-world.ts), in the worker, and kept: the
// highways between blocks as soon as the scene loads, and the lanes inside a
// holder of files the first time it is drawn with its files from
// FILE_LANES_PX. The camera never changes a lane; each zoom level only cuts
// the highways at the closed containers drawn for their ends
// (clip-highways.ts), and decides which holders' lanes show. With the overlay
// on, every lane is drawn; with it off, only those of the hovered or selected
// nodes.

export interface LaneFrame {
  // Every highway drawn at this zoom level, with the overlay on.
  all: LaneRoutes | undefined
  // Per link of all, the focus.ts direction bits of the focus's imports it
  // carries, 0 for none; undefined when nothing in focus has such a link.
  hot: Uint8Array | undefined
  // With the overlay off, the highways drawn at this level, of which only
  // those with direction bits in focusHot show.
  focus: LaneRoutes | undefined
  focusHot: Uint8Array | undefined
  // The lanes inside the holders of files drawn on screen, from FILE_LANES_PX.
  files: FileLanes[]
  // Drawn nodes at the other end of the focus's imports, by id, with the
  // direction bits of the imports that reach them.
  partners: ReadonlyMap<string, number>
}

export interface FileLanes {
  routes: LaneRoutes
  // Direction bits per link, as for LaneFrame.hot.
  hot: Uint8Array | undefined
  // Every lane shows, not only those of the focus.
  isAll: boolean
}

interface Holder {
  readonly node: WorldNode
}

type Job = { kind: 'highways' } | { kind: 'holder'; holder: string }

// Zoom levels and holders whose lanes are kept; routing them again gives the
// same lanes.
const MAX_LEVELS = 16
const MAX_HOLDERS = 512

let versions = 0

export class LaneLayer {
  private readonly router: LaneRouterHandle
  private readonly onChange: () => void
  private readonly version = ++versions
  private readonly scene: Scene
  private readonly links: LinkCache
  // The scene's import edges, in the order the worker has them.
  private readonly edges: LaneEdge[] = []
  private highways: Highways | undefined
  private readonly levels = new Map<number, LaneRoutes>()
  private readonly holders = new Map<string, HolderRoutes>()
  private hot: { focus: Focus; links: Uint8Array | undefined } | undefined
  private holderHot = new WeakMap<HolderRoutes, Uint8Array | undefined>()
  private holderHotFocus: Focus | undefined
  private busy: Job | undefined
  private readonly wanted: Job[] = []

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
      const { id, kind, rect } = node
      nodes.push(node.parent ? { id, parent: node.parent, kind, rect } : { id, kind, rect })
    }
    router.loadWorld(this.version, nodes, this.edges)
  }

  // The lanes to draw at this scale. holders: the drawn nodes that can hold
  // a link end; focus: the hovered or selected nodes, if any.
  frame(scale: number, holders: readonly Holder[], focus: Focus, isOverlayOn: boolean): LaneFrame {
    const frame: LaneFrame = {
      all: undefined,
      hot: undefined,
      focus: undefined,
      focusHot: undefined,
      files: [],
      partners: new Map(),
    }
    const hasFocus = focus.ids.length > 0
    const jobs: Job[] = []
    if (!this.highways) {
      jobs.push({ kind: 'highways' })
    } else if (isOverlayOn || hasFocus) {
      const routes = this.resolveLevel(scale)
      const hot = hasFocus ? this.listHot(focus) : undefined
      if (isOverlayOn) {
        frame.all = routes
        frame.hot = hot
      } else if (hot) {
        frame.focus = routes
        frame.focusHot = hot
      }
      if (scale >= FILE_LANES_PX) {
        for (const holder of this.listFileHolders(holders)) {
          const routed = this.holders.get(holder)
          if (!routed) {
            jobs.push({ kind: 'holder', holder })
            continue
          }
          const lanes = hasFocus ? this.listHolderHot(routed, focus) : undefined
          if (isOverlayOn || lanes) {
            frame.files.push({ routes: routed.routes, hot: lanes, isAll: isOverlayOn })
          }
        }
      }
    }
    this.want(jobs)

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

  // The highways as drawn at the level a scale falls in, cut once per level.
  private resolveLevel(scale: number): LaneRoutes {
    const level = Math.floor(Math.log2(scale) * LINK_LEVELS_PER_OCTAVE)
    let routes = this.levels.get(level)
    if (!routes) {
      routes = clipHighways(this.highways as Highways, this.links, this.links.getDrawnLevel(scale))
      keep(this.levels, level, routes, MAX_LEVELS)
    }
    return routes
  }

  // The holders (route-boxes.ts) of the files drawn, in id order: a module of
  // files, or a folder's own files beside its subfolders.
  private listFileHolders(holders: readonly Holder[]): string[] {
    const found = new Set<string>()
    for (const { node } of holders) {
      if (node.kind !== 'file' || !node.parent) continue
      const parent = this.scene.byId.get(node.parent)
      if (!parent) continue
      const hasFolders = this.scene.children
        .get(parent.id)
        ?.some((kid) => kid.kind !== 'file' && kid.kind !== 'symbol')
      found.add(hasFolders ? looseId(parent.id) : parent.id)
    }
    return [...found].sort()
  }

  // Which way each highway carries imports into or out of a focused node, or
  // undefined when none does. Imports inside one are left out, as in the
  // inspector; imports between two focused nodes count.
  private listHot(focus: Focus): Uint8Array | undefined {
    if (this.hot?.focus === focus) return this.hot.links
    const { linkOfEdge, links: all } = this.highways as Highways
    let links: Uint8Array | undefined
    this.edges.forEach(([from, to], e) => {
      const link = linkOfEdge[e] as number
      const direction = link < 0 ? 0 : focusDirection(focus, from, to)
      if (direction === 0) return
      links ??= new Uint8Array(all.length)
      links[link] = (links[link] as number) | direction
    })
    this.hot = { focus, links }
    return links
  }

  // The same for a holder's lanes, kept per focus.
  private listHolderHot(routed: HolderRoutes, focus: Focus): Uint8Array | undefined {
    if (this.holderHotFocus !== focus) {
      this.holderHotFocus = focus
      this.holderHot = new WeakMap()
    }
    if (this.holderHot.has(routed)) return this.holderHot.get(routed)
    let links: Uint8Array | undefined
    const count = routed.routes.links.length
    for (let i = 0; i < count; i++) {
      let direction = 0
      for (
        let k = routed.edgeOffsets[i] as number;
        k < (routed.edgeOffsets[i + 1] as number);
        k++
      ) {
        const [from, to] = this.edges[routed.edges[k] as number] as LaneEdge
        direction |= focusDirection(focus, from, to)
      }
      if (direction === 0) continue
      links ??= new Uint8Array(count)
      links[i] = direction
    }
    this.holderHot.set(routed, links)
    return links
  }

  // Asks for the jobs this frame needs once the one in flight is done; they
  // replace any asked for before that have not started.
  private want(jobs: Job[]): void {
    this.wanted.length = 0
    for (const job of jobs) if (!this.busy || !sameJob(this.busy, job)) this.wanted.push(job)
    this.run()
  }

  private run(): void {
    if (this.busy) return
    const job = this.wanted.shift()
    if (!job) return
    this.busy = job
    const done = () => {
      this.busy = undefined
      this.onChange()
      this.run()
    }
    const failed = () => {
      // A stale or failed job; the next frame asks again if still needed.
      this.busy = undefined
      this.run()
    }
    if (job.kind === 'highways') {
      this.router.routeHighways(this.version).then((highways) => {
        this.highways = highways
        done()
      }, failed)
      return
    }
    this.router.routeHolder(this.version, job.holder).then((routed) => {
      keep(this.holders, job.holder, routed, MAX_HOLDERS)
      done()
    }, failed)
  }
}

function sameJob(a: Job, b: Job): boolean {
  return a.kind === b.kind && (a.kind !== 'holder' || b.kind !== 'holder' || a.holder === b.holder)
}

// Adds a value, dropping the oldest once more than max are held.
function keep<K, T>(map: Map<K, T>, key: K, value: T, max: number): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}
