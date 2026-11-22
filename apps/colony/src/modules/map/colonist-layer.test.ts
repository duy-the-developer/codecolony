import { describe, expect, it } from 'vitest'
import { type PlacedChange, type PlacedColonist, placeColonists } from '../scene/colonist-places.ts'
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

function placed(id: string, initials: string): PlacedColonist {
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
    initials,
    changes: [{ path: 'a.ts', kind: 'modified', nodeId: 'm/a.ts', holderId: 'm/a.ts' }],
    folders: [],
    bounds: { x: 2, y: 3, w: 4, h: 4 },
  }
}

function shared(one: PlacedColonist, two: PlacedColonist): PlacedColonist[] {
  const [a, b] = [one, two].map((item) => ({
    ...item,
    changes: item.changes.map((change) => ({ ...change })),
  })) as [PlacedColonist, PlacedColonist]
  ;(a.changes[0] as PlacedChange).sharedWith = [b.colonist.id]
  ;(b.changes[0] as PlacedChange).sharedWith = [a.colonist.id]
  return [a, b]
}

const OPEN = [drawn('r', 1, 1), drawn('m', 1, 1), drawn('m/a.ts', 1, 0)]

describe('ColonistLayer', () => {
  it('puts a pin over the top right of a changed file, and finds it there', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O')])
    layer.drawChanges(ctx, scene, camera, OPEN)
    // The file spans 20..60 across and 30..70 down; the pin sits above its
    // corner and points into it.
    expect(layer.hitPin(55, 20)).toMatchObject({ kind: 'pin', colonistId: '/one' })
    expect(layer.hitPin(20, 50)).toBeUndefined()
    expect(layer.isAnimated).toBe(false)
  })

  it('moves to the closed folder when the file is too faint to show', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O')])
    layer.drawChanges(ctx, scene, camera, [
      drawn('r', 1, 1),
      drawn('m', 1, 0.2),
      drawn('m/a.ts', 0.2, 0),
    ])
    // The module spans 10..210 across from 20 down.
    const hit = layer.hitPin(205, 10)
    expect(hit).toMatchObject({ kind: 'pin', colonistId: '/one' })
    expect(hit?.kind === 'pin' && hit.pin.text).toBe('O 1')
  })

  it('finds the conflict badge left of the pins of two colonists on one file', () => {
    const layer = new ColonistLayer()
    layer.setColonists(shared(placed('/one', 'O'), placed('/two', 'T')))
    layer.drawChanges(ctx, scene, camera, OPEN)
    const [, second] = layer.pins.pins
    const [badge] = layer.pins.badges
    expect(second?.colonistId).toBe('/two')
    expect(layer.hitPin((second?.head.x ?? 0) + 2, 20)).toMatchObject({ colonistId: '/two' })
    expect(layer.hitPin(badge?.x ?? 0, badge?.y ?? 0)).toMatchObject({
      kind: 'conflict',
      badge: { nodeId: 'm/a.ts', colonistIds: ['/one', '/two'] },
    })
  })

  it('pulses only while a colonist on screen waits on you', () => {
    const layer = new ColonistLayer()
    const waiting = placed('/one', 'O')
    waiting.colonist.status = 'waiting'
    layer.setColonists([waiting])
    layer.drawChanges(ctx, scene, camera, OPEN)
    expect(layer.isAnimated).toBe(true)
  })

  it('forgets a picked colonist that is gone', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O')])
    layer.selected = '/one'
    layer.setColonists([])
    expect(layer.selected).toBeUndefined()
  })
})

describe('ColonistLayer pins in lifted rows', () => {
  // b.ts sits half a unit right of a.ts, so at 5px a unit one file's row of
  // pins is lifted above the other's.
  const tight = new Scene({
    version: 1,
    indexedAt: '',
    languages: {},
    nodes: [
      node('w', 'world', { x: 0, y: 0, w: 40, h: 40 }),
      node('r', 'repo', { x: 0, y: 0, w: 40, h: 40 }, 'w'),
      node('r/m', 'module', { x: 1, y: 2, w: 20, h: 20 }, 'r'),
      node('r/m/a.ts', 'file', { x: 2, y: 3, w: 4, h: 4 }, 'r/m'),
      node('r/m/b.ts', 'file', { x: 6.5, y: 3, w: 4, h: 4 }, 'r/m'),
    ],
    edges: [],
  } satisfies World)
  const near = new Camera()
  near.scale = 5
  const frame = ['r', 'r/m', 'r/m/a.ts', 'r/m/b.ts'].map((id): Drawn => {
    const item = tight.byId.get(id) as WorldNode
    const { x, y, w, h } = item.rect
    return { node: item, x: x * 5, y: y * 5, w: w * 5, h: h * 5, alpha: 1, open: 1 }
  })

  it('finds every pin by its head, never through the stem of a lifted pin', () => {
    const layer = new ColonistLayer()
    const both = (id: string): PlacedColonist['colonist'] => ({
      ...placed(id, '').colonist,
      changes: [
        { path: 'm/a.ts', kind: 'modified', units: 1 },
        { path: 'm/b.ts', kind: 'modified', units: 1 },
      ],
    })
    layer.setColonists(placeColonists(tight, [both('/one'), both('/two')]))
    layer.drawChanges(ctx, tight, near, frame)
    const { pins } = layer.pins
    expect(new Set(pins.map((pin) => pin.head.y)).size).toBeGreaterThan(1)
    for (const pin of pins) {
      const hit = layer.hitPin(pin.head.x + pin.head.w / 2, pin.head.y + pin.head.h / 2)
      expect(hit).toMatchObject({ kind: 'pin', colonistId: pin.colonistId })
    }
  })
})
