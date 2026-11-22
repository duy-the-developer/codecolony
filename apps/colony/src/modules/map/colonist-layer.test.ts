import { describe, expect, it } from 'vitest'
import type { PlacedColonist } from '../scene/colonist-places.ts'
import { Scene } from '../scene/scene.ts'
import type { NodeKind, Rect, World, WorldNode } from '../world/world-types.ts'
import { Camera } from './camera.ts'
import { ColonistLayer } from './colonist-layer.ts'
import type { Drawn } from './render.ts'

function node(id: string, kind: NodeKind, rect: Rect, parent?: string): WorldNode {
  const base = { id, kind, name: id, lines: 1, complexity: 0, rect }
  return parent === undefined ? base : { ...base, parent }
}

// world > repo r > module m > a.ts
const scene = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node('w', 'world', { x: 0, y: 0, w: 40, h: 40 }),
    node('r', 'repo', { x: 0, y: 0, w: 40, h: 40 }, 'w'),
    node('m', 'module', { x: 1, y: 2, w: 20, h: 20 }, 'r'),
    node('m/a.ts', 'file', { x: 2, y: 3, w: 4, h: 4 }, 'm'),
  ],
  edges: [],
} satisfies World)

const camera = new Camera()
camera.scale = 10

// A 2D context that accepts every call and draws nothing.
const ctx = new Proxy(
  { canvas: { clientWidth: 800, clientHeight: 600 } },
  {
    get: (target, key) =>
      key in target
        ? target[key as keyof typeof target]
        : key === 'measureText'
          ? () => ({ width: 10 })
          : () => undefined,
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D

function drawn(id: string, alpha: number, open: number): Drawn {
  const item = scene.byId.get(id) as WorldNode
  const { x, y, w, h } = item.rect
  return { node: item, x: x * 10, y: y * 10, w: w * 10, h: h * 10, alpha, open }
}

function placed(id: string): PlacedColonist {
  const colonist: PlacedColonist['colonist'] = {
    id,
    repoId: 'r',
    label: id,
    status: 'working',
    session: 'own',
    copy: id,
    head: 'abc1234',
    base: 'main',
    changes: [{ path: 'a.ts', kind: 'modified', units: 1 }],
    omitted: 0,
  }
  return {
    colonist,
    changes: [{ path: 'a.ts', kind: 'modified', nodeId: 'm/a.ts', holderId: 'm/a.ts' }],
    folders: [],
    bounds: { x: 2, y: 3, w: 4, h: 4 },
  }
}

describe('ColonistLayer', () => {
  it('puts one marker over the top right of a changed file, and finds it there', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one')])
    layer.drawChanges(ctx, scene, camera, [
      drawn('r', 1, 1),
      drawn('m', 1, 1),
      drawn('m/a.ts', 1, 0),
    ])
    // The file spans 20..60 across and 30..70 down; the chip sits above its corner.
    expect(layer.hitMarker(57, 15)).toBe('/one')
    expect(layer.hitMarker(20, 50)).toBeUndefined()
    expect(layer.isAnimated).toBe(true)
  })

  it('moves to the closed folder when the file is too faint to show', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one')])
    layer.drawChanges(ctx, scene, camera, [
      drawn('r', 1, 1),
      drawn('m', 1, 0.2),
      drawn('m/a.ts', 0.2, 0),
    ])
    // The module spans 10..210 across from 20 down.
    expect(layer.hitMarker(207, 5)).toBe('/one')
  })

  it('sets markers of colonists on the same spot side by side', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one'), placed('/two')])
    layer.drawChanges(ctx, scene, camera, [
      drawn('r', 1, 1),
      drawn('m', 1, 1),
      drawn('m/a.ts', 1, 0),
    ])
    expect(layer.hitMarker(57, 15)).toBe('/one')
    expect(layer.hitMarker(57 + 28, 15)).toBe('/two')
  })

  it('forgets a picked colonist that is gone', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one')])
    layer.selected = '/one'
    layer.setColonists([])
    expect(layer.selected).toBeUndefined()
  })
})
