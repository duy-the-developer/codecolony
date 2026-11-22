import { describe, expect, it } from 'vitest'
import { Scene } from '../scene/scene.ts'
import type { NodeKind, World, WorldNode } from '../world/world-types.ts'
import { buildFocus, DEPENDANT, DEPENDS_ON, focusDirection, NO_FOCUS } from './focus.ts'

function node(id: string, kind: NodeKind, parent?: string): WorldNode {
  const base = { id, kind, name: id, lines: 1, complexity: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }
  return parent === undefined ? base : { ...base, parent }
}

// world > modules a and b, one file each, and c.ts on its own.
const scene = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node('w', 'world'),
    node('a', 'module', 'w'),
    node('a/f.ts', 'file', 'a'),
    node('b', 'module', 'w'),
    node('b/g.ts', 'file', 'b'),
    node('c.ts', 'file', 'w'),
  ],
  edges: [],
} satisfies World)

describe('buildFocus', () => {
  it('holds each node with its subtree, and all of them together', () => {
    const focus = buildFocus(scene, ['a', 'b'])
    expect(focus.ids).toEqual(['a', 'b'])
    expect(focus.subtrees.map((s) => [...s].sort())).toEqual([
      ['a', 'a/f.ts'],
      ['b', 'b/g.ts'],
    ])
    expect([...focus.all].sort()).toEqual(['a', 'a/f.ts', 'b', 'b/g.ts'])
  })

  it('keys the same nodes in the same order the same way', () => {
    expect(buildFocus(scene, ['a', 'b']).key).toBe(buildFocus(scene, ['a', 'b']).key)
    expect(buildFocus(scene, ['a', 'b']).key).not.toBe(buildFocus(scene, ['b', 'a']).key)
  })

  it('leaves out ids not on the map', () => {
    expect(buildFocus(scene, ['gone', 'a']).ids).toEqual(['a'])
    expect(buildFocus(scene, ['gone'])).toBe(NO_FOCUS)
    expect(buildFocus(scene, [])).toBe(NO_FOCUS)
  })
})

describe('focusDirection', () => {
  it('tells edges out of a focused node from edges into one', () => {
    const focus = buildFocus(scene, ['a', 'b'])
    expect(focusDirection(focus, 'a/f.ts', 'c.ts')).toBe(DEPENDS_ON)
    expect(focusDirection(focus, 'c.ts', 'b/g.ts')).toBe(DEPENDANT)
  })

  it('counts an edge between two focused nodes both ways', () => {
    const focus = buildFocus(scene, ['a', 'b'])
    expect(focusDirection(focus, 'a/f.ts', 'b/g.ts')).toBe(DEPENDS_ON | DEPENDANT)
  })

  it('leaves out edges inside one focused node or outside all of them', () => {
    const focus = buildFocus(scene, ['a', 'b'])
    expect(focusDirection(focus, 'a', 'a/f.ts')).toBe(0)
    expect(focusDirection(focus, 'c.ts', 'w')).toBe(0)
  })
})
