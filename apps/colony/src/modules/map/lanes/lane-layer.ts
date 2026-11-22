import type { RouteNode } from '../../lane-routing/route-boxes.ts'
import type { Scene } from '../../scene/scene.ts'
import type { WorldNode } from '../../world/world-types.ts'
import { crossesFocus, type Focus } from '../focus.ts'
import { LinkCache } from '../link-cache.ts'
import type { LaneRouterHandle } from './lane-router.ts'
import type { LaneEdge, LaneLevel, LaneRoutes } from './lane-world.ts'

// The Dependency overlay's lanes for one scene, frame by frame. Each zoom
// level (../link-cache.ts) has its own blocks, so lanes are routed per level, in
// the worker, and kept for levels with the same open containers. With the
// overlay on, every link of the level is routed; with it off, only the links
// of the hovered or selected nodes. Until a level's routes arrive, the last
// ones routed are drawn.

export interface LaneFrame {
  // Every link of the level, with the overlay on.
  all: LaneRoutes | undefined
  // Per link of all's level, whether it stands out (1) because it carries an
  // import of the focus; undefined when nothing in focus has such a link.
  // Kept while the focus and level stay the same.
  hot: Uint8Array | undefined
  // Only the focus's links, with the overlay off.
  focus: LaneRoutes | undefined
  // Drawn nodes at the other end of the focus's imports, by id.
  partners: ReadonlySet<string>
}

interface Holder {
  readonly node: WorldNode
}

type Job =
  | { kind: 'level'; key: string; open: readonly string[] }
  | { kind: 'all'; key: string; open: readonly string[] }
  | { kind: 'focus'; key: string; open: readonly string[]; focus: string; only: number[] }

// Routed results kept per kind.
const MAX_KEPT = 6

let versions = 0

export class LaneLayer {
  private readonly router: LaneRouterHandle
  private readonly onChange: () => void
  private readonly version = ++versions
  private readonly links: LinkCache
  // The scene's import edges, in the order the worker has them.
  private readonly edges: LaneEdge[] = []
  private readonly levels = new Map<string, LaneLevel>()
  private readonly allRoutes = new Map<string, LaneRoutes>()
  private readonly focusRoutes = new Map<string, LaneRoutes>()
  private lastAll: { key: string; routes: LaneRoutes } | undefined
  private hot: { key: string; focus: Focus; links: Uint8Array | undefined } | undefined
  private busy: Job | undefined
  private wanted: Job | undefined

  constructor(scene: Scene, router: LaneRouterHandle, onChange: () => void) {
    this.router = router
    this.onChange = onChange
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
    const open = this.links.listOpenContainers(scale)
    const level = this.levels.get(open.key)
    let job: Job | undefined
    const frame: LaneFrame = {
      all: undefined,
      hot: undefined,
      focus: undefined,
      partners: new Set(),
    }
    if (!level) {
      job = { kind: 'level', key: open.key, open: open.ids }
    } else if (isOverlayOn) {
      if (!this.allRoutes.has(open.key)) job = { kind: 'all', key: open.key, open: open.ids }
    } else if (focus.ids.length > 0) {
      const hot = this.listHot(open.key, level, focus)
      const only: number[] = []
      hot?.forEach((isHot, link) => {
        if (isHot) only.push(link)
      })
      frame.focus = this.focusRoutes.get(`${open.key}\n${focus.key}`)
      if (!frame.focus && only.length > 0) {
        job = { kind: 'focus', key: open.key, open: open.ids, focus: focus.key, only }
      }
    }
    if (isOverlayOn) {
      const routed = this.allRoutes.get(open.key)
      const shown = routed ? { key: open.key, routes: routed } : this.lastAll
      const shownLevel = shown && this.levels.get(shown.key)
      if (shown && shownLevel) {
        frame.all = shown.routes
        if (focus.ids.length > 0) frame.hot = this.listHot(shown.key, shownLevel, focus)
      }
    }
    this.want(job)

    if (focus.ids.length > 0) {
      const partners = new Set<string>()
      const links = this.links.listLinks(scale, holders, focus.all)
      for (let r = 0; r < links.count; r++) {
        if (!links.hot[r] || links.kind[r] !== 'import') continue
        const from = holders[links.from[r] as number]?.node.id
        const to = holders[links.to[r] as number]?.node.id
        if (from && !focus.all.has(from)) partners.add(from)
        if (to && !focus.all.has(to)) partners.add(to)
      }
      frame.partners = partners
    }
    return frame
  }

  // Which of a level's links carry an import into or out of a focused node,
  // or undefined when none does. Imports inside one are left out, as in the
  // inspector; imports between two focused nodes count.
  private listHot(key: string, level: LaneLevel, focus: Focus): Uint8Array | undefined {
    if (this.hot?.key === key && this.hot.focus === focus) return this.hot.links
    let links: Uint8Array | undefined
    this.edges.forEach(([from, to], e) => {
      const link = level.linkOfEdge[e] as number
      if (link < 0 || !crossesFocus(focus, from, to)) return
      links ??= new Uint8Array(level.links.length)
      links[link] = 1
    })
    this.hot = { key, focus, links }
    return links
  }

  // Asks for a job once the one in flight is done; a newer wish replaces an
  // older one that has not started.
  private want(job: Job | undefined): void {
    if (!job || (this.busy && sameJob(this.busy, job))) return
    this.wanted = job
    this.run()
  }

  private run(): void {
    const job = this.wanted
    if (this.busy || !job) return
    this.busy = job
    this.wanted = undefined
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
    if (job.kind === 'level') {
      this.router.describeLevel(this.version, job.key, job.open).then((level) => {
        keep(this.levels, job.key, level)
        done()
      }, failed)
      return
    }
    this.router
      .route(this.version, job.key, job.open, job.kind === 'focus' ? job.only : undefined)
      .then((routes) => {
        if (job.kind === 'all') {
          keep(this.allRoutes, job.key, routes)
          this.lastAll = { key: job.key, routes }
        } else {
          keep(this.focusRoutes, `${job.key}\n${job.focus}`, routes)
        }
        done()
      }, failed)
  }
}

function sameJob(a: Job, b: Job): boolean {
  return (
    a.kind === b.kind &&
    a.key === b.key &&
    (a.kind !== 'focus' || b.kind !== 'focus' || a.focus === b.focus)
  )
}

// Adds a value, dropping the oldest once more than MAX_KEPT are held.
function keep<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > MAX_KEPT) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}
