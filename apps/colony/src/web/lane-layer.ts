import type { RouteNode } from '../shared/route-boxes.ts'
import type { WorldNode } from '../shared/world-types.ts'
import type { LaneRouterHandle } from './lane-router.ts'
import type { LaneEdge, LaneLevel, LaneRoutes } from './lane-world.ts'
import { LinkCache } from './link-cache.ts'
import type { Scene } from './scene.ts'

// The Dependency overlay's lanes for one scene, frame by frame. Each zoom
// level (link-cache.ts) has its own blocks, so lanes are routed per level, in
// the worker, and kept for levels with the same open containers. With the
// overlay on, every link of the level is routed; with it off, only the links
// of the hovered or selected node. Until a level's routes arrive, the last
// ones routed are drawn.

export type LaneEmphasis = 'normal' | 'hot' | 'dim'

export interface FrameLane {
  // Corner points x0, y0, x1, y1, ... in world units, from the importer to
  // the imported block, whose edge gets the arrowhead.
  points: Float64Array
  emphasis: LaneEmphasis
}

export interface LaneFrame {
  lanes: FrameLane[]
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
  private hot: { key: string; subtree: ReadonlySet<string>; links: Uint8Array } | undefined
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
  // a link end; focus: the hovered or selected node, if any.
  frame(
    scale: number,
    holders: readonly Holder[],
    focus: string | undefined,
    focusSubtree: ReadonlySet<string>,
    isOverlayOn: boolean,
  ): LaneFrame {
    const open = this.links.listOpenContainers(scale)
    const level = this.levels.get(open.key)
    let job: Job | undefined
    const lanes: FrameLane[] = []
    if (!level) {
      job = { kind: 'level', key: open.key, open: open.ids }
    } else if (isOverlayOn) {
      if (!this.allRoutes.has(open.key)) job = { kind: 'all', key: open.key, open: open.ids }
    } else if (focus) {
      const hot = this.listHot(open.key, level, focusSubtree)
      const only: number[] = []
      hot.forEach((isHot, link) => {
        if (isHot) only.push(link)
      })
      const routes = this.focusRoutes.get(`${open.key}\n${focus}`)
      if (routes) addLanes(lanes, routes, () => 'hot')
      else if (only.length > 0) job = { kind: 'focus', key: open.key, open: open.ids, focus, only }
    }
    if (isOverlayOn) {
      const routed = this.allRoutes.get(open.key)
      const shown = routed ? { key: open.key, routes: routed } : this.lastAll
      if (shown) {
        const shownLevel = this.levels.get(shown.key)
        const hot =
          focus && shownLevel ? this.listHot(shown.key, shownLevel, focusSubtree) : undefined
        addLanes(lanes, shown.routes, (link) => (hot ? (hot[link] ? 'hot' : 'dim') : 'normal'))
      }
    }
    this.want(job)

    const partners = new Set<string>()
    if (focus) {
      const frame = this.links.listLinks(scale, holders, focusSubtree)
      for (let r = 0; r < frame.count; r++) {
        if (!frame.hot[r] || frame.kind[r] !== 'import') continue
        const from = holders[frame.from[r] as number]?.node.id
        const to = holders[frame.to[r] as number]?.node.id
        if (from && !focusSubtree.has(from)) partners.add(from)
        if (to && !focusSubtree.has(to)) partners.add(to)
      }
    }
    return { lanes, partners }
  }

  // Which of a level's links carry an import into or out of the focus. Imports
  // inside it are left out, as in the inspector.
  private listHot(key: string, level: LaneLevel, subtree: ReadonlySet<string>): Uint8Array {
    if (this.hot?.key === key && this.hot.subtree === subtree) return this.hot.links
    const links = new Uint8Array(level.links.length)
    this.edges.forEach(([from, to], e) => {
      const link = level.linkOfEdge[e] as number
      if (link >= 0 && subtree.has(from) !== subtree.has(to)) links[link] = 1
    })
    this.hot = { key, subtree, links }
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

// Adds each routed link's lane, drawn as emphasisOf(its link) says.
function addLanes(
  lanes: FrameLane[],
  routes: LaneRoutes,
  emphasisOf: (link: number) => LaneEmphasis,
): void {
  for (let i = 0; i < routes.links.length; i++) {
    const start = routes.offsets[i] as number
    const end = routes.offsets[i + 1] as number
    if (end <= start) continue
    lanes.push({
      points: routes.points.subarray(start, end),
      emphasis: emphasisOf(routes.links[i] as number),
    })
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
