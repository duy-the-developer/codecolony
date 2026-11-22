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
})
