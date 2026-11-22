import { describe, expect, it } from 'vitest'
import type { Colonist } from '../wire/api-types.ts'
import type { Rect, World, WorldNode } from '../world/world-types.ts'
import { placeColonists } from './colonist-places.ts'
import { Scene } from './scene.ts'

function node(id: string, kind: WorldNode['kind'], rect: Rect, parent?: string): WorldNode {
  const made: WorldNode = { id, kind, name: id, lines: 10, complexity: 0, rect }
  if (parent) made.parent = parent
  return made
}

// r is a repository with a module src holding a.ts and b.ts.
const WORLD: World = {
  version: 1,
  indexedAt: '',
  languages: {},
  edges: [],
  nodes: [
    node('world', 'world', { x: 0, y: 0, w: 20, h: 20 }),
    node('r', 'repo', { x: 0, y: 0, w: 20, h: 20 }, 'world'),
    node('r/src', 'module', { x: 1, y: 2, w: 10, h: 8 }, 'r'),
    node('r/src/a.ts', 'file', { x: 2, y: 3, w: 2, h: 2 }, 'r/src'),
    node('r/src/b.ts', 'file', { x: 4, y: 3, w: 1, h: 1 }, 'r/src'),
  ],
}

function colonist(changes: Colonist['changes'], repoId = 'r'): Colonist {
  return {
    id: '/copy',
    repoId,
    label: 'task',
    status: 'working',
    session: 'firstmate',
    copy: '/copy',
    head: 'abc1234',
    base: 'main',
    changes,
    omitted: 0,
  }
}

describe('placeColonists', () => {
  it('outlines files on the map and finds free spots for added ones', () => {
    const [placed] = placeColonists(new Scene(WORLD), [
      colonist([
        { path: 'src/a.ts', kind: 'modified', units: 1 },
        { path: 'src/gone.ts', kind: 'removed', units: 1 },
        { path: 'src/new.ts', kind: 'added', units: 2 },
        { path: 'src/queue/read.ts', kind: 'added', units: 1 },
        { path: 'src/queue/write.ts', kind: 'added', units: 3 },
        { path: 'top.ts', kind: 'added', units: 1 },
      ]),
    ])
    expect(placed?.changes).toEqual([
      { path: 'src/a.ts', kind: 'modified', nodeId: 'r/src/a.ts', holderId: 'r/src/a.ts' },
      { path: 'src/gone.ts', kind: 'removed' },
      {
        path: 'src/new.ts',
        kind: 'added',
        holderId: 'r/src',
        placeholder: { x: 5, y: 3, w: 2, h: 2 },
      },
      {
        path: 'src/queue/read.ts',
        kind: 'added',
        holderId: 'r/src',
        placeholder: { x: 2.5, y: 6, w: 1, h: 1 },
      },
      {
        path: 'src/queue/write.ts',
        kind: 'added',
        holderId: 'r/src',
        placeholder: { x: 4, y: 6, w: 1, h: 1 },
      },
      { path: 'top.ts', kind: 'added', holderId: 'r', placeholder: { x: 11, y: 2, w: 1, h: 1 } },
    ])
    expect(placed?.folders).toEqual([
      { name: 'queue', holderId: 'r/src', rect: { x: 2, y: 5, w: 3.5, h: 2.5 }, header: 1 },
    ])
    expect(placed?.bounds).toEqual({ x: 2, y: 2, w: 10, h: 5.5 })
  })

  it('keeps colonists in one folder apart and shrinks to fit', () => {
    const big = (path: string) => ({ path, kind: 'added' as const, units: 4 })
    const placed = placeColonists(new Scene(WORLD), [
      colonist([big('src/x.ts')]),
      colonist([big('src/y.ts')]),
    ])
    const [x, y] = placed.map((p) => p.changes[0]?.placeholder)
    expect(x).toEqual({ x: 5, y: 3, w: 4, h: 4 })
    expect(y).toEqual({ x: 2, y: 5, w: 2, h: 2 })
  })

  it('lists the changes of a repository that is not on the map', () => {
    const [placed] = placeColonists(new Scene(WORLD), [
      colonist([{ path: 'a.ts', kind: 'modified', units: 1 }], 'elsewhere'),
    ])
    expect(placed).toEqual({
      colonist: expect.anything(),
      changes: [{ path: 'a.ts', kind: 'modified' }],
      folders: [],
    })
  })
})
