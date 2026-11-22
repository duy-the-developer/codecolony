import { describe, expect, it } from 'vitest'
import type { Rect } from '../world/world-types.ts'
import { buildChannelGraph, laneCapacity, type RouteBox } from './channel-graph.ts'
import { countChannelLoad, type LaneRouting, type Link, routeLanes } from './route-lanes.ts'

function block(id: string, x: number, y: number, w: number, h: number): RouteBox {
  return { id, rect: { x, y, w, h } }
}

// Two packages side by side, each with a 2-unit label strip, 1-unit padding
// and two rows of blocks `gutter` units apart.
function makeWorld(gutter: number): { root: RouteBox; blocks: RouteBox[] } {
  const g = gutter
  const pkg = (id: string, x: number) => {
    const kids = [
      block(`${id}/a`, x + 1, 2, 5, 4),
      block(`${id}/b`, x + 1 + 5 + g, 2, 4, 4),
      block(`${id}/c`, x + 1, 2 + 4 + g, 3, 3),
      block(`${id}/d`, x + 1 + 3 + g, 2 + 4 + g, 6, 5),
    ]
    const w = 1 + Math.max(5 + g + 4, 3 + g + 6) + 1
    const h = 2 + 4 + g + 5 + 1
    const box: RouteBox = { id, rect: { x, y: 0, w, h }, header: 2, kids }
    return { box, kids, w, h }
  }
  const p = pkg('p', 0)
  const q = pkg('q', p.w + g)
  const root: RouteBox = {
    id: 'world',
    rect: { x: 0, y: 0, w: p.w + g + q.w, h: p.h },
    header: 0,
    kids: [p.box, q.box],
  }
  return { root, blocks: [...p.kids, ...q.kids] }
}

function linkEveryPair(blocks: RouteBox[]): Link[] {
  const links: Link[] = []
  for (const a of blocks) for (const b of blocks) if (a !== b) links.push({ from: a.id, to: b.id })
  return links
}

interface Segment {
  link: number
  isHorizontal: boolean
  across: number
  from: number
  to: number
}

function listSegments(routing: LaneRouting): Segment[] {
  const segments: Segment[] = []
  routing.points.forEach((points, link) => {
    if (!points) return
    for (let k = 0; k + 3 < points.length; k += 2) {
      const [x0, y0, x1, y1] = [points[k], points[k + 1], points[k + 2], points[k + 3]] as [
        number,
        number,
        number,
        number,
      ]
      if (x0 === x1 && y0 === y1) continue
      if (x0 !== x1 && y0 !== y1) throw new Error(`diagonal segment in link ${link}`)
      const isHorizontal = y0 === y1
      const [a, b] = isHorizontal ? [x0, x1] : [y0, y1]
      segments.push({
        link,
        isHorizontal,
        across: isHorizontal ? y0 : x0,
        from: Math.min(a, b),
        to: Math.max(a, b),
      })
    }
  })
  return segments
}

// Collinear overlaps longer than a point between lines of different links.
function countOverlaps(segments: Segment[]): number {
  let overlaps = 0
  segments.forEach((a, i) => {
    for (const b of segments.slice(i + 1)) {
      if (a.link === b.link || a.isHorizontal !== b.isHorizontal || a.across !== b.across) continue
      if (Math.min(a.to, b.to) > Math.max(a.from, b.from)) overlaps++
    }
  })
  return overlaps
}

// Segments that pass through a block.
function countBlockHits(segments: Segment[], blocks: RouteBox[]): number {
  let hits = 0
  for (const s of segments) {
    for (const { rect } of blocks) {
      const [x0, x1, y0, y1] = [rect.x, rect.x + rect.w, rect.y, rect.y + rect.h]
      const inside = s.isHorizontal
        ? s.across > y0 && s.across < y1 && s.to > x0 && s.from < x1
        : s.across > x0 && s.across < x1 && s.to > y0 && s.from < y1
      if (inside) hits++
    }
  }
  return hits
}

function isOnSide(rect: Rect, x: number, y: number): boolean {
  const onX = x === rect.x || x === rect.x + rect.w
  const onY = y === rect.y || y === rect.y + rect.h
  return (onX && y > rect.y && y < rect.y + rect.h) || (onY && x > rect.x && x < rect.x + rect.w)
}

describe('buildChannelGraph', () => {
  it('cuts the gutters between rows and slots into channels', () => {
    const { root } = makeWorld(2)
    const graph = buildChannelGraph(root)
    const describe = graph.channels.map(
      (c) => `${c.container} ${c.axis} ${c.low}-${c.high} after ${c.after.join(',')}`,
    )
    expect(describe).toContain('world y 13-15 after q')
    expect(describe).toContain('p x 6-8 after p/c,p/d')
    expect(describe).toContain('p y 6-8 after p/b')
    expect(graph.stuck).toBe(0)
  })

  it('keeps lines off the label strip above the first row', () => {
    const { root } = makeWorld(2)
    const graph = buildChannelGraph(root)
    const sides = (graph.blockAttachments.get('p/a') ?? []).map((a) => graph.attachments[a]?.side)
    expect(sides).not.toContain('top')
    expect(sides).toContain('bottom')
  })
})

describe('routeLanes', () => {
  it('routes every link from a side of its importer to a side of the imported block', () => {
    const { root, blocks } = makeWorld(2)
    const links = linkEveryPair(blocks)
    const routing = routeLanes(buildChannelGraph(root), links)
    const rects = new Map(blocks.map((b) => [b.id, b.rect]))
    links.forEach((link, i) => {
      const p = routing.points[i] as Float64Array
      expect(p, `${link.from} -> ${link.to}`).toBeDefined()
      const n = p.length
      expect(isOnSide(rects.get(link.from) as Rect, p[0] as number, p[1] as number)).toBe(true)
      expect(isOnSide(rects.get(link.to) as Rect, p[n - 2] as number, p[n - 1] as number)).toBe(
        true,
      )
    })
  })

  it('never crosses a block', () => {
    const { root, blocks } = makeWorld(2)
    const routing = routeLanes(buildChannelGraph(root), linkEveryPair(blocks))
    expect(countBlockHits(listSegments(routing), blocks)).toBe(0)
  })

  it('puts lanes on whole units one apart and never overlaps them when there is room', () => {
    const { root } = makeWorld(40)
    // A few links per block, so every block side has a port for each.
    const pairs = [
      ['p/a', 'p/d'],
      ['p/b', 'q/c'],
      ['q/a', 'p/c'],
      ['q/d', 'p/b'],
      ['p/c', 'q/b'],
      ['q/b', 'p/a'],
      ['p/d', 'q/a'],
      ['q/c', 'p/d'],
    ]
    const routing = routeLanes(
      buildChannelGraph(root),
      pairs.map(([from, to]) => ({ from, to }) as Link),
    )
    expect(routing.crowded).toBe(0)
    for (const points of routing.points) {
      for (const value of points ?? []) expect(Number.isInteger(value)).toBe(true)
    }
    expect(countOverlaps(listSegments(routing))).toBe(0)
  })

  it('merges links into shared lanes when a gutter is full', () => {
    const { root, blocks } = makeWorld(2)
    const graph = buildChannelGraph(root)
    const links = linkEveryPair(blocks)
    // Level 1: the imported block; level 2: everything.
    const mergeKey = (link: number, level: number) =>
      level === 1 ? (links[link] as Link).to : level === 2 ? 'all' : undefined
    const routing = routeLanes(graph, links, { merge: 'whenFull', mergeKey })
    graph.channels.forEach((channel, c) => {
      if ((routing.load[c] as number) > 0) {
        expect(routing.lanes[c]).toBeLessThanOrEqual(Math.max(1, laneCapacity(channel)))
      }
    })
    expect(routing.merged).toBeGreaterThan(0)
    expect(countBlockHits(listSegments(routing), blocks)).toBe(0)
  })

  it('goes round a block that fills a whole row', () => {
    const wall = block('wall', 0, 6, 30, 4)
    const above = block('above', 0, 0, 5, 4)
    const below = block('below', 0, 12, 5, 4)
    const root: RouteBox = {
      id: 'world',
      rect: { x: 0, y: 0, w: 30, h: 16 },
      header: 0,
      kids: [above, wall, below],
    }
    const routing = routeLanes(buildChannelGraph(root), [{ from: 'above', to: 'below' }])
    expect(routing.points[0]).toBeDefined()
    expect(countBlockHits(listSegments(routing), [above, wall, below])).toBe(0)
  })

  it('counts the same channel load as a full routing', () => {
    const { root, blocks } = makeWorld(2)
    const graph = buildChannelGraph(root)
    const links = linkEveryPair(blocks)
    expect([...countChannelLoad(graph, links)]).toEqual([...routeLanes(graph, links).load])
  })
})
