import { describe, expect, it } from 'vitest'
import { buildChannelGraph, type RouteBox } from './channel-graph.ts'
import { type Link, routeLanes } from './route-lanes.ts'

function block(id: string, x: number, y: number, w: number, h: number): RouteBox {
  return { id, rect: { x, y, w, h } }
}

// A module of files with a label strip `header` units tall, as the world's
// only box.
function makeModule(files: RouteBox[], w: number, h: number, header = 1): RouteBox {
  const module: RouteBox = { id: 'm', rect: { x: 0, y: 0, w, h }, header, kids: files }
  return { id: 'world', rect: { x: 0, y: 0, w, h }, header: 0, kids: [module] }
}

function linkEveryPair(blocks: RouteBox[]): Link[] {
  const links: Link[] = []
  for (const a of blocks) for (const b of blocks) if (a !== b) links.push({ from: a.id, to: b.id })
  return links
}

// Links with no path, or one that leaves the module for the ring around the
// map.
function countDetours(root: RouteBox, blocks: RouteBox[]): number {
  const [module] = root.kids ?? []
  if (!module) throw new Error('no module')
  const { w, h } = module.rect
  const routing = routeLanes(buildChannelGraph(root), linkEveryPair(blocks))
  return routing.points.filter((points) => {
    if (!points) return true
    for (let k = 0; k < points.length; k += 2) {
      const x = points[k] as number
      const y = points[k + 1] as number
      if (x < 0 || y < 0 || x > w || y > h) return true
    }
    return false
  }).length
}

describe('buildChannelGraph', () => {
  // Two columns of files a 1-unit street apart, flush under the label strip.
  // a ends where d starts, across the columns: a cut there would hold no
  // channel and leave the street between the columns in pieces.
  const files = [
    block('a', 1, 1, 2, 2),
    block('b', 1, 4, 1, 1),
    block('c', 4, 1, 1, 1),
    block('d', 4, 3, 2, 2),
  ]

  it('gives every file a side on a channel when rows touch across columns', () => {
    const graph = buildChannelGraph(makeModule(files, 7, 6))
    expect(graph.stuck).toBe(0)
    for (const file of files) {
      const sides = (graph.blockAttachments.get(file.id) ?? []).map(
        (a) => graph.attachments[a]?.side,
      )
      expect(sides, file.id).toContain('right')
    }
  })

  it('routes between every pair of files inside the module', () => {
    expect(countDetours(makeModule(files, 7, 6), files)).toBe(0)
  })

  it('cuts at gaps before touching edges when there is no label strip', () => {
    const loose = files.map(({ id, rect }) => block(id, rect.x, rect.y - 1, rect.w, rect.h))
    expect(countDetours(makeModule(loose, 7, 5, 0), loose)).toBe(0)
  })

  it('keeps the label strip free of lanes', () => {
    const graph = buildChannelGraph(makeModule(files, 7, 6))
    for (const channel of graph.channels) {
      if (channel.container !== 'm') continue
      const top = channel.axis === 'x' ? channel.low : channel.start
      expect(top).toBeGreaterThanOrEqual(1)
    }
  })

  it('still cuts touching boxes apart when no gap parts them', () => {
    const touching = [block('a', 1, 1, 2, 2), block('b', 1, 3, 2, 2)]
    const graph = buildChannelGraph(makeModule(touching, 4, 6))
    expect(graph.stuck).toBe(0)
    expect(graph.blockAttachments.get('a')?.length).toBeGreaterThan(0)
    expect(graph.blockAttachments.get('b')?.length).toBeGreaterThan(0)
  })

  // A folder with a 1-unit label strip and 1-unit padding all round, a and b
  // side by side in its top row with a gutter between, and c below them.
  const folder: RouteBox = {
    id: 'f',
    rect: { x: 2, y: 2, w: 12, h: 11 },
    header: 1,
    kids: [block('f/a', 3, 4, 4, 3), block('f/b', 9, 4, 4, 3), block('f/c', 3, 9, 10, 3)],
  }
  const world: RouteBox = {
    id: 'world',
    rect: { x: 0, y: 0, w: 16, h: 15 },
    header: 0,
    kids: [folder],
  }

  it('lines an open folder with a ring of channels below its label strip', () => {
    const graph = buildChannelGraph(world)
    const ring = graph.channels
      .filter((channel) => channel.container === 'f' && channel.ring)
      .map((c) => `${c.ring} ${c.axis} ${c.low}-${c.high} ${c.start}-${c.end}`)
    expect(ring).toEqual([
      'left y 2-3 3-13',
      'right y 13-14 3-13',
      'top x 3-4 3-13',
      'bottom x 12-13 3-13',
    ])
  })

  it('opens doors out of the folder only where a gutter or the ring ends on its left, right or bottom', () => {
    const graph = buildChannelGraph(world)
    const gutter = graph.channels.findIndex((c) => c.container === 'f' && !c.ring && c.axis === 'y')
    const doors = graph.attachments.filter(
      (a) =>
        a.channel !== undefined &&
        graph.channels[a.channel]?.container === 'f' &&
        graph.channels[a.bar]?.container === 'world',
    )
    // The gutter between a and b ends on the top of the ring, which has no door,
    // and on c: no way out.
    expect(doors.some((a) => a.channel === gutter)).toBe(false)
    const sides = doors.map((a) => graph.channels[a.channel as number]?.ring)
    // The ring's top and bottom open sideways, its sides open at the bottom,
    // and the gutter between the rows opens at both ends.
    expect(sides.filter((side) => side === 'top')).toHaveLength(2)
    expect(sides.filter((side) => side === 'bottom')).toHaveLength(2)
    expect(sides.filter((side) => side === 'left' || side === 'right')).toHaveLength(2)
    expect(sides.filter((side) => side === undefined)).toHaveLength(2)
  })

  it('routes between boxes that only the ring joins without leaving the folder', () => {
    // a sits on b, so no gutter parts them: a line from one to the other goes
    // round by the ring.
    const stacked: RouteBox = {
      ...folder,
      kids: [block('f/a', 3, 4, 4, 3), block('f/b', 3, 7, 10, 5)],
    }
    const root = { ...world, kids: [stacked] }
    const routing = routeLanes(buildChannelGraph(root), [
      { from: 'f/a', to: 'f/b' },
      { from: 'f/b', to: 'f/a' },
    ])
    for (const points of routing.points) {
      expect(points).toBeDefined()
      for (let k = 0; k < (points?.length ?? 0); k += 2) {
        const x = points?.[k] as number
        const y = points?.[k + 1] as number
        expect(x > 2 && x < 14 && y > 3 && y < 13, `${x},${y}`).toBe(true)
      }
    }
  })
})
