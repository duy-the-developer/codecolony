import { describe, expect, it } from 'vitest'
import type { Colonist } from '../wire/api-types.ts'
import type { Rect, World, WorldNode } from '../world/world-types.ts'
import { pickInitials, placeColonists } from './colonist-places.ts'
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

  it('names the first folder that is new, past folders merged into a subfolder', () => {
    // a holds only a/b, which holds only a/b/c: the map shows a and a/b/c.
    const withPath = (made: WorldNode, path: string) => ({ ...made, path })
    const world: World = {
      ...WORLD,
      nodes: [
        node('world', 'world', { x: 0, y: 0, w: 20, h: 20 }),
        node('r', 'repo', { x: 0, y: 0, w: 20, h: 20 }, 'world'),
        withPath(node('r/a', 'module', { x: 1, y: 2, w: 12, h: 10 }, 'r'), 'a'),
        withPath(node('r/a/b/c', 'module', { x: 2, y: 3, w: 4, h: 4 }, 'r/a'), 'a/b/c'),
        withPath(node('r/a/b/c/f.ts', 'file', { x: 2, y: 4, w: 2, h: 2 }, 'r/a/b/c'), 'a/b/c/f.ts'),
      ],
    }
    const [placed] = placeColonists(new Scene(world), [
      colonist([
        { path: 'a/b/x/new.ts', kind: 'added', units: 1 },
        { path: 'a/b/loose.ts', kind: 'added', units: 1 },
      ]),
    ])
    expect(placed?.folders.map(({ name, holderId }) => ({ name, holderId }))).toEqual([
      { name: 'x', holderId: 'r/a' },
    ])
    expect(placed?.changes.map(({ path, holderId }) => ({ path, holderId }))).toEqual([
      { path: 'a/b/x/new.ts', holderId: 'r/a' },
      { path: 'a/b/loose.ts', holderId: 'r/a' },
    ])
    expect(placed?.changes[1]?.placeholder).toBeDefined()
  })

  it('lists the changes of a repository that is not on the map', () => {
    const [placed] = placeColonists(new Scene(WORLD), [
      colonist([{ path: 'a.ts', kind: 'modified', units: 1 }], 'elsewhere'),
    ])
    expect(placed).toEqual({
      colonist: expect.anything(),
      initials: 'TA',
      changes: [{ path: 'a.ts', kind: 'modified' }],
      folders: [],
    })
  })

  it('names the other colonists changing the same file in the same repository', () => {
    const one = { ...colonist([{ path: 'src/a.ts', kind: 'modified', units: 1 }]), id: '/one' }
    const two = {
      ...colonist([
        { path: 'src/a.ts', kind: 'modified', units: 1 },
        { path: 'src/b.ts', kind: 'modified', units: 1 },
      ]),
      id: '/two',
    }
    const away = { ...colonist([{ path: 'src/a.ts', kind: 'modified', units: 1 }], 'x'), id: '/x' }
    const [first, second, third] = placeColonists(new Scene(WORLD), [one, two, away])
    expect(first?.changes[0]?.sharedWith).toEqual(['/two'])
    expect(second?.changes.map((change) => change.sharedWith)).toEqual([['/one'], undefined])
    expect(third?.changes[0]?.sharedWith).toBeUndefined()
  })

  it('gives every colonist different initials', () => {
    const placed = placeColonists(new Scene(WORLD), [
      { ...colonist([]), id: '/1', label: 'colonist-pins' },
      { ...colonist([]), id: '/2', label: 'colonist-panel' },
      { ...colonist([]), id: '/3', label: 'build-queue' },
    ])
    expect(placed.map((item) => item.initials)).toEqual(['CP', 'CO', 'BQ'])
  })
})

describe('pickInitials', () => {
  const repo = { ...WORLD.nodes[1], name: 'codecolony' } as WorldNode

  it('leaves out the repository name a firstmate task id starts with', () => {
    expect(pickInitials('codecolony-colonist-pins', repo, new Set())).toBe('CP')
  })

  it('reads a copy label by its place', () => {
    expect(pickInitials('codecolony-d64159/5 · detached', repo, new Set())).toBe('D5')
    expect(pickInitials('p/codecolony · production', repo, new Set())).toBe('PC')
  })

  it('takes the first two letters of a single word', () => {
    expect(pickInitials('scout', repo, new Set())).toBe('SC')
  })
})
