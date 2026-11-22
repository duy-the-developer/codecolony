import { describe, expect, it } from 'vitest'
import type { NodeKind, World, WorldNode } from '../world/world-types.ts'
import { findChangeTarget } from './change-target.ts'
import { Scene } from './scene.ts'

function node(id: string, kind: NodeKind, parent: string, path?: string, name = id): WorldNode {
  const base = {
    id,
    kind,
    name,
    parent,
    lines: 10,
    complexity: 0,
    rect: { x: 0, y: 0, w: 1, h: 1 },
  }
  return path === undefined ? base : { ...base, path }
}

// app > repo app > src (a.ts, ui (b.ts, c.ts)), README.md
const R = 'p:app/app'
const scene = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    {
      id: 'world',
      kind: 'world',
      name: 'world',
      lines: 0,
      complexity: 0,
      rect: { x: 0, y: 0, w: 1, h: 1 },
    },
    node('p:app', 'project', 'world', undefined, 'app'),
    node(R, 'repo', 'p:app', undefined, 'app'),
    node('m:src', 'module', R, 'src'),
    node(`${R}/src/a.ts`, 'file', 'm:src', 'src/a.ts'),
    node('m:src/ui', 'module', 'm:src', 'src/ui'),
    node(`${R}/src/ui/b.ts`, 'file', 'm:src/ui', 'src/ui/b.ts'),
    node(`${R}/src/ui/c.ts`, 'file', 'm:src/ui', 'src/ui/c.ts'),
    node(`${R}/README.md`, 'file', R, 'README.md'),
  ],
  edges: [],
} satisfies World)

const target = (paths: string[]) =>
  findChangeTarget(scene, { project: 'app', repo: 'app', paths })?.id

describe('findChangeTarget', () => {
  it('is the file itself when one file changed', () => {
    expect(target(['src/ui/b.ts'])).toBe(`${R}/src/ui/b.ts`)
  })

  it('is the smallest folder that holds every changed file', () => {
    expect(target(['src/ui/b.ts', 'src/ui/c.ts'])).toBe('m:src/ui')
    expect(target(['src/ui/b.ts', 'src/a.ts'])).toBe('m:src')
    expect(target(['src/a.ts', 'README.md'])).toBe(R)
  })

  it('places a file that is not on the map in its nearest folder that is', () => {
    expect(target(['src/ui/new/d.ts'])).toBe('m:src/ui')
    expect(target(['docs/new.md'])).toBe(R)
  })

  it('has no target without changes or for a project not on the map', () => {
    expect(target([])).toBeUndefined()
    expect(
      findChangeTarget(scene, { project: 'other', repo: 'other', paths: ['a'] }),
    ).toBeUndefined()
  })
})
