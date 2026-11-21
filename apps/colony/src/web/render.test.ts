import { describe, expect, it } from 'vitest'
import type { NodeKind, World, WorldNode } from '../shared/world-types.ts'
import { type Drawn, hoverTarget } from './render.ts'
import { Scene } from './scene.ts'

function node(id: string, kind: NodeKind, parent?: string): WorldNode {
  const base = { id, kind, name: id, lines: 1, complexity: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }
  return parent === undefined ? base : { ...base, parent }
}

// world > project > repo > package > module > file > symbol
const scene = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node('w', 'world'),
    node('p', 'project', 'w'),
    node('r', 'repo', 'p'),
    node('k', 'package', 'r'),
    node('m', 'module', 'k'),
    node('m/f.ts', 'file', 'm'),
    node('m/f.ts#run', 'symbol', 'm/f.ts'),
  ],
  edges: [],
} satisfies World)

function drawn(id: string, open: number): Drawn {
  const item = scene.byId.get(id)
  if (!item) throw new Error(id)
  return { node: item, x: 0, y: 0, w: 1, h: 1, alpha: 1, open }
}

describe('hoverTarget', () => {
  it('puts a symbol’s file in focus', () => {
    expect(hoverTarget(scene, drawn('m/f.ts#run', 0))).toBe('m/f.ts')
  })

  it('puts files and modules in focus, open or closed', () => {
    for (const open of [0, 1]) {
      expect(hoverTarget(scene, drawn('m/f.ts', open))).toBe('m/f.ts')
      expect(hoverTarget(scene, drawn('m', open))).toBe('m')
    }
  })

  it('puts packages, repositories and projects in focus only while closed', () => {
    for (const id of ['k', 'r', 'p']) {
      expect(hoverTarget(scene, drawn(id, 0))).toBe(id)
      expect(hoverTarget(scene, drawn(id, 1))).toBeUndefined()
    }
  })

  it('puts nothing in focus for the world', () => {
    expect(hoverTarget(scene, drawn('w', 1))).toBeUndefined()
  })
})
