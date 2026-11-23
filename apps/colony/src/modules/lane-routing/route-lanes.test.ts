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

// Collinear overlaps longer than a point between lines of different links,
// leaving out pairs that may share a lane.
function countOverlaps(
  segments: Segment[],
  mayShare: (a: number, b: number) => boolean = () => false,
): number {
  let overlaps = 0
  segments.forEach((a, i) => {
    for (const b of segments.slice(i + 1)) {
      if (a.link === b.link || a.isHorizontal !== b.isHorizontal || a.across !== b.across) continue
      if (mayShare(a.link, b.link)) continue
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

  it('puts lanes on whole units one apart, overlapping only on a shared highway', () => {
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
    // Lines from one package into the other share the highway between them.
    const folderOf = (id: string) => id.slice(0, id.indexOf('/'))
    const crossing = (link: number) => {
      const [from, to] = pairs[link] as [string, string]
      return folderOf(from) === folderOf(to) ? undefined : `${folderOf(from)}>${folderOf(to)}`
    }
    const mayShare = (a: number, b: number) =>
      crossing(a) !== undefined && crossing(a) === crossing(b)
    expect(countOverlaps(listSegments(routing), mayShare)).toBe(0)
    expect(countOverlaps(listSegments(routing))).toBeGreaterThan(0)
  })

  it('keeps lanes a stride apart where they fit, and closer only where they do not', () => {
    // On a half-unit pitch: every length doubled, lanes a whole unit (2) apart.
    const double = (box: RouteBox): RouteBox => ({
      id: box.id,
      rect: { x: box.rect.x * 2, y: box.rect.y * 2, w: box.rect.w * 2, h: box.rect.h * 2 },
      ...(box.header === undefined ? {} : { header: box.header * 2 }),
      ...(box.kids ? { kids: box.kids.map(double) } : {}),
    })
    const { root } = makeWorld(40, 6)
    const pairs = [
      ['p/a', 'p/d'],
      ['p/b', 'q/c'],
      ['q/a', 'q/d'],
    ]
    const links = pairs.map(([from, to]) => ({ from, to }) as Link)
    const wide = routeLanes(buildChannelGraph(double(root)), links, { stride: 2 })
    for (const points of wide.points) {
      expect(points).toBeDefined()
      for (const value of points ?? []) expect(value % 2).toBe(0)
    }
    // A 1-unit street between two blocks holds no whole unit, so a lane
    // along it sits half a unit off each. b sits a row lower than a, so the
    // line has to turn in the street.
    const street: RouteBox = {
      id: 'world',
      rect: { x: 0, y: 0, w: 10, h: 9 },
      header: 0,
      kids: [block('a', 2, 2, 2, 2), block('b', 5, 5, 2, 2)],
    }
    const narrow = routeLanes(buildChannelGraph(double(street), true), [{ from: 'a', to: 'b' }], {
      stride: 2,
    })
    const points = [...(narrow.points[0] ?? [])]
    expect(points).toContain(9)
  })

  it('merges lines heading to one end when a gutter is full', () => {
    const { root, blocks } = makeWorld(2)
    const graph = buildChannelGraph(root)
    const links = linkEveryPair(blocks)
    const roomy = routeLanes(graph, links)
    const routing = routeLanes(graph, links, { merge: 'whenFull' })
    expect(routing.merged).toBeGreaterThan(0)
    // Lanes past the room left pack closer instead.
    expect(routing.crowded).toBeGreaterThan(0)
    // A channel merges only when its stretches do not fit, and never below a
    // lane each for the ends they run to.
    graph.channels.forEach((channel, c) => {
      const own = roomy.lanes[c] as number
      const lanes = routing.lanes[c] as number
      if (own <= laneCapacity(channel)) expect(lanes, `channel ${c}`).toBe(own)
      else expect(lanes, `channel ${c}`).toBeLessThanOrEqual(own)
      if (own > 0) expect(lanes, `channel ${c}`).toBeGreaterThan(0)
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

  it('counts the lanes a full routing takes', () => {
    const { root, blocks } = makeWorld(2)
    const graph = buildChannelGraph(root)
    const links = linkEveryPair(blocks)
    expect([...countChannelLoad(graph, links)]).toEqual([...routeLanes(graph, links).lanes])
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

  it('brings a line in through the top door straight down onto its lane in the ring', () => {
    // f's label strip runs y 4-5 with its label over x 0-3, and its ring's
    // top channel y 5-8 above w, a file as wide as the door.
    const f: RouteBox = {
      id: 'f',
      rect: { x: 0, y: 4, w: 14, h: 14 },
      header: 1,
      label: 3,
      kids: [block('f/w', 2, 8, 10, 3), block('f/x', 2, 13, 10, 3)],
    }
    const root: RouteBox = {
      id: 'world',
      rect: { x: 0, y: 0, w: 14, h: 18 },
      header: 0,
      kids: [block('o', 4, 0, 6, 2), f],
    }
    const routing = routeLanes(buildChannelGraph(root), [
      { from: 'o', to: 'f/x' },
      { from: 'f/w', to: 'o' },
    ])
    expect(routing.points.every((points) => points !== undefined)).toBe(true)
    const segments = listSegments(routing)
    const door = segments.find((s) => s.link === 0 && !s.isHorizontal && s.from < 4 && s.to > 5)
    if (!door) throw new Error('no line through the door')
    // Down through the strip right of the label and on to a lane in the top
    // channel, where it turns.
    expect(door.across).toBeGreaterThan(3)
    expect(door.to).toBeGreaterThan(5)
    expect(door.to).toBeLessThan(8)
    const turn = segments.find(
      (s) =>
        s.link === 0 && s.isHorizontal && s.across === door.to && s.from <= door.across,
    )
    expect(turn?.to).toBeGreaterThanOrEqual(door.across)
    // w's port up into the channel stays off the door line's spot.
    const [portX] = routing.points[1] as Float64Array
    expect(portX).not.toBe(door.across)
    expect(countOverlaps(segments)).toBe(0)
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

  describe('highways between folders', () => {
    // p spans x 0-61 and q x 101-162, with a 40-unit gutter between them.
    const { root } = makeWorld(40, 6)
    const graph = buildChannelGraph(root)
    // Runs across the middle of the gutter, by link.
    const acrossGutter = (routing: LaneRouting) =>
      listSegments(routing).filter((s) => s.isHorizontal && s.from < 81 && s.to > 81)

    it('runs every line from one folder to another along one highway', () => {
      const links: Link[] = [
        { from: 'p/a', to: 'q/c' },
        { from: 'p/b', to: 'q/d' },
        { from: 'p/d', to: 'q/a' },
      ]
      const runs = acrossGutter(routeLanes(graph, links))
      expect(new Set(runs.map((s) => s.link))).toEqual(new Set([0, 1, 2]))
      expect(new Set(runs.map((s) => s.across)).size).toBe(1)
    })

    it('keeps lines into a folder and lines out of it on separate lanes', () => {
      const routing = routeLanes(graph, [
        { from: 'p/a', to: 'q/c' },
        { from: 'q/d', to: 'p/b' },
      ])
      expect(new Set(acrossGutter(routing).map((s) => s.across)).size).toBe(2)
      expect(countOverlaps(listSegments(routing))).toBe(0)
    })

    it('enters a folder through one entry point per side', () => {
      const ids = ['a', 'b', 'c', 'd']
      const links = ids.flatMap((a) => ids.map((b) => ({ from: `p/${a}`, to: `q/${b}` })))
      const routing = routeLanes(graph, links)
      // Where lines cross q's left border.
      const entries = listSegments(routing).filter(
        (s) => s.isHorizontal && s.from < 101 && s.to > 101,
      )
      expect(routing.points.every((points) => points !== undefined)).toBe(true)
      expect(new Set(entries.map((s) => s.across)).size).toBe(1)
    })
  })
})
