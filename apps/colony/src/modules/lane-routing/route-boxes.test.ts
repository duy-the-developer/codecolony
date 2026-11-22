import { describe, expect, it } from 'vitest'
import type { NodeKind, Rect, WorldNode } from '../world/world-types.ts'
import type { RouteBox } from './channel-graph.ts'
import { buildRouteBoxes, looseId } from './route-boxes.ts'

function node(id: string, kind: NodeKind, parent: string | undefined, rect: Rect): WorldNode {
  const base = { id, kind, name: id, lines: 1, complexity: 0, rect }
  return parent === undefined ? base : { ...base, parent }
}

// world > repo r > package p (two modules, one with a submodule) and a loose
// file directly in r.
const NODES: WorldNode[] = [
  node('world', 'world', undefined, { x: 0, y: 0, w: 60, h: 40 }),
  node('r', 'repo', 'world', { x: 0, y: 0, w: 60, h: 40 }),
  node('r/p', 'package', 'r', { x: 1, y: 2, w: 40, h: 30 }),
  node('r/p/a', 'module', 'r/p', { x: 2, y: 4, w: 10, h: 10 }),
  node('r/p/a/1.ts', 'file', 'r/p/a', { x: 3, y: 5, w: 2, h: 2 }),
  node('r/p/b', 'module', 'r/p', { x: 14, y: 4, w: 20, h: 20 }),
  node('r/p/b/2.ts', 'file', 'r/p/b', { x: 15, y: 5, w: 2, h: 2 }),
  node('r/p/b/c', 'module', 'r/p/b', { x: 20, y: 5, w: 8, h: 8 }),
  node('r/p/b/c/3.ts', 'file', 'r/p/b/c', { x: 21, y: 6, w: 2, h: 2 }),
  node('r/root.ts', 'file', 'r', { x: 44, y: 3, w: 3, h: 3 }),
  node('r/root.ts#f', 'symbol', 'r/root.ts', { x: 44, y: 3, w: 3, h: 1 }),
]

function listIds(box: RouteBox | undefined): string[] {
  if (!box) return []
  return [box.kids ? `${box.id}/` : box.id, ...(box.kids ?? []).flatMap(listIds)]
}

describe('buildRouteBoxes', () => {
  it('makes modules of files into blocks and opens folders that hold folders', () => {
    const { root } = buildRouteBoxes(NODES)
    expect(listIds(root)).toEqual([
      'world/',
      'r/',
      'r/p/',
      'r/p/a',
      'r/p/b/',
      'r/p/b/c',
      looseId('r/p/b'),
      looseId('r'),
    ])
  })

  it('finds the block that holds a file or symbol', () => {
    const boxes = buildRouteBoxes(NODES)
    expect(boxes.blockOf('r/p/a/1.ts')).toBe('r/p/a')
    expect(boxes.blockOf('r/p/b/2.ts')).toBe(looseId('r/p/b'))
    expect(boxes.blockOf('r/root.ts#f')).toBe(looseId('r'))
  })

  it('keeps files inside their block until their holder opens', () => {
    expect(buildRouteBoxes(NODES).hasFileBlocks).toBe(false)
  })

  it('makes each file of an open module a block of its own', () => {
    const boxes = buildRouteBoxes(
      NODES,
      () => true,
      (id) => id === 'r/p/a',
    )
    expect(listIds(boxes.root)).toEqual([
      'world/',
      'r/',
      'r/p/',
      'r/p/a/',
      'r/p/a/1.ts',
      'r/p/b/',
      'r/p/b/c',
      looseId('r/p/b'),
      looseId('r'),
    ])
    expect(boxes.blockOf('r/p/a/1.ts')).toBe('r/p/a/1.ts')
    expect(boxes.blockOf('r/p/b/2.ts')).toBe(looseId('r/p/b'))
    expect(boxes.hasFileBlocks).toBe(true)
  })

  it('opens the files directly in a container by their group id', () => {
    const boxes = buildRouteBoxes(
      NODES,
      () => true,
      (id) => id === looseId('r'),
    )
    expect(listIds(boxes.root).slice(-2)).toEqual([`${looseId('r')}/`, 'r/root.ts'])
    expect(boxes.blockOf('r/root.ts#f')).toBe('r/root.ts')
  })

  it('treats a closed container as one block', () => {
    const boxes = buildRouteBoxes(NODES, (id) => id !== 'r/p')
    expect(listIds(boxes.root)).toEqual(['world/', 'r/', 'r/p', looseId('r')])
    expect(boxes.blockOf('r/p/b/c/3.ts')).toBe('r/p')
  })
})
