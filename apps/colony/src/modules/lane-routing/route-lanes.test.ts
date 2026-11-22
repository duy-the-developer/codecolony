import { describe, expect, it } from 'vitest'
import type { Rect } from '../world/world-types.ts'
import { buildChannelGraph, laneCapacity, type RouteBox } from './channel-graph.ts'
import { countChannelLoad, type LaneRouting, type Link, routeLanes } from './route-lanes.ts'

function block(id: string, x: number, y: number, w: number, h: number): RouteBox {
  return { id, rect: { x, y, w, h } }
}

// Two packages side by side, each with a 2-unit label strip, `pad` units of
// padding left, right and below, and two rows of blocks `gutter` units apart.
function makeWorld(gutter: number, pad = 1): { root: RouteBox; blocks: RouteBox[] } {
  const g = gutter
  const pkg = (id: string, x: number) => {
    const kids = [
      block(`${id}/a`, x + pad, 2, 5, 4),
      block(`${id}/b`, x + pad + 5 + g, 2, 4, 4),
      block(`${id}/c`, x + pad, 2 + 4 + g, 3, 3),
      block(`${id}/d`, x + pad + 3 + g, 2 + 4 + g, 6, 5),
    ]
    const w = pad + Math.max(5 + g + 4, 3 + g + 6) + pad
    const h = 2 + 4 + g + 5 + pad
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
    const { root } = makeWorld(40, 6)
    // A few links per block, so every block side has a port for each, and
    // across the packages one way only: two lines that swap places between
    // doors facing each other across a gutter cannot help overlapping there.
    const pairs = [
      ['p/a', 'p/d'],
      ['p/b', 'q/c'],
      ['p/c', 'q/b'],
      ['p/d', 'q/a'],
      ['q/a', 'q/d'],
      ['q/c', 'q/b'],
      ['p/c', 'p/b'],
      ['q/b', 'q/d'],
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

  it('merges only links to the same block when a gutter is full', () => {
    const { root, blocks } = makeWorld(2)
    const graph = buildChannelGraph(root)
    const links = linkEveryPair(blocks)
    const routing = routeLanes(graph, links, { merge: 'whenFull' })
    expect(routing.merged).toBeGreaterThan(0)
    // Lanes past the room left pack closer instead.
    expect(routing.crowded).toBeGreaterThan(0)
    // The blocks imported through each channel: a full channel takes a lane
    // per imported block, never fewer.
    const targets: Set<string>[] = graph.channels.map(() => new Set())
    for (const link of links) {
      countChannelLoad(graph, [link]).forEach((n, c) => {
        if (n > 0) targets[c]?.add(link.to)
      })
    }
    graph.channels.forEach((channel, c) => {
      const load = routing.load[c] as number
      const want = load > laneCapacity(channel) ? (targets[c] as Set<string>).size : load
      expect(routing.lanes[c], `channel ${c}`).toBe(want)
    })
    expect(countBlockHits(listSegments(routing), blocks)).toBe(0)
  })

  it('never merges a link with its reverse, even with no room', () => {
    const a = block('a', 0, 0, 4, 4)
    const b = block('b', 0, 5, 4, 4)
    const root: RouteBox = {
      id: 'world',
      rect: { x: 0, y: 0, w: 4, h: 9 },
      header: 0,
      kids: [a, b],
    }
    const routing = routeLanes(
      buildChannelGraph(root),
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      { merge: 'whenFull' },
    )
    expect(routing.merged).toBe(0)
    expect(routing.crowded).toBeGreaterThan(0)
    const [ab, ba] = routing.points as [Float64Array, Float64Array]
    // Both cross the 1-unit gutter straight down, apart.
    expect(ab[0]).not.toBe(ba[0])
    expect(countOverlaps(listSegments(routing))).toBe(0)
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

  it('keeps links between the boxes of one folder inside it', () => {
    const { root, blocks } = makeWorld(2, 2)
    const p = root.kids?.[0] as RouteBox
    const inP = blocks.filter((b) => b.id.startsWith('p/'))
    const routing = routeLanes(buildChannelGraph(root), linkEveryPair(inP))
    const { x, y, w, h } = p.rect
    for (const points of routing.points) {
      expect(points).toBeDefined()
      for (let k = 0; k < (points?.length ?? 0); k += 2) {
        const px = points?.[k] as number
        const py = points?.[k + 1] as number
        // Inside the border, below the label strip.
        expect(px > x && px < x + w && py > y + 2 && py < y + h, `${px},${py}`).toBe(true)
      }
    }
  })

  it('stays inside the folder even when going out over its label is shorter', () => {
    // A tall folder: a wall flush under the label strip parts a from b, so
    // inside, the way round is down to the bottom of the ring and back up.
    const kids = [
      block('s/a', 1, 1, 4, 4),
      block('s/a2', 1, 7, 4, 32),
      block('s/wall', 7, 1, 2, 38),
      block('s/b', 11, 1, 4, 4),
      block('s/b2', 11, 7, 4, 32),
    ]
    const folder: RouteBox = { id: 's', rect: { x: 0, y: 0, w: 16, h: 40 }, header: 1, kids }
    const root: RouteBox = { id: 'world', rect: folder.rect, header: 0, kids: [folder] }
    const routing = routeLanes(buildChannelGraph(root), [{ from: 's/a', to: 's/b' }])
    const points = routing.points[0] as Float64Array
    expect(points).toBeDefined()
    for (let k = 0; k < points.length; k += 2) {
      const x = points[k] as number
      const y = points[k + 1] as number
      expect(x > 0 && x < 16 && y > 0 && y < 40, `${x},${y}`).toBe(true)
    }
  })

  it('leaves a link unrouted when its folder cannot join the two ends inside', () => {
    // A wall from the label strip down to the bottom border parts a from b;
    // the only way between them is out of the folder and round it.
    const kids = [block('s/a', 1, 3, 4, 4), block('s/wall', 7, 3, 2, 10), block('s/b', 11, 3, 4, 4)]
    const folder: RouteBox = { id: 's', rect: { x: 0, y: 2, w: 16, h: 11 }, header: 1, kids }
    const root: RouteBox = {
      id: 'world',
      rect: { x: 0, y: 0, w: 16, h: 16 },
      header: 0,
      kids: [folder],
    }
    const routing = routeLanes(buildChannelGraph(root), [{ from: 's/a', to: 's/b' }])
    expect(routing.points[0]).toBeUndefined()
    expect([...routing.load].every((n) => n === 0)).toBe(true)
  })

  it('never passes through a folder on the way to another', () => {
    // Three folders in a row; the middle one has a gutter straight across it,
    // with doors at both ends, that would be the shortest way from l to r.
    const folder = (id: string, x: number): RouteBox => ({
      id,
      rect: { x, y: 0, w: 8, h: 12 },
      header: 1,
      kids: [block(`${id}/top`, x + 2, 3, 4, 3), block(`${id}/bottom`, x + 2, 8, 4, 2)],
    })
    const l = folder('l', 0)
    const m = folder('m', 10)
    const r = folder('r', 20)
    const root: RouteBox = {
      id: 'world',
      rect: { x: 0, y: 0, w: 28, h: 12 },
      header: 0,
      kids: [l, m, r],
    }
    const routing = routeLanes(buildChannelGraph(root), [{ from: 'l/top', to: 'r/top' }])
    const points = routing.points[0] as Float64Array
    expect(points).toBeDefined()
    for (const s of listSegments(routing)) {
      const crossesM = s.isHorizontal
        ? s.across > 0 && s.across < 12 && s.to > 10 && s.from < 18
        : s.across > 10 && s.across < 18
      expect(crossesM, JSON.stringify(s)).toBe(false)
    }
  })
})
