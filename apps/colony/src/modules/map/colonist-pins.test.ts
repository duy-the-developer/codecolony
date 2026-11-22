import { describe, expect, it } from 'vitest'
import { type PlacedColonist, placeColonists } from '../scene/colonist-places.ts'
import { Scene } from '../scene/scene.ts'
import type { NodeKind, Rect, World, WorldNode } from '../world/world-types.ts'
import { Camera } from './camera.ts'
import { layoutPins } from './colonist-pins.ts'
import type { Drawn } from './render.ts'

function node(id: string, kind: NodeKind, rect: Rect, parent?: string): WorldNode {
  const base = { id, kind, name: id, lines: 1, complexity: 0, rect }
  return parent === undefined ? base : { ...base, parent }
}

// world > repository r > module r/m > a.ts and b.ts, with room for
// placeholders below them.
const scene = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node('w', 'world', { x: 0, y: 0, w: 40, h: 40 }),
    { ...node('r', 'repo', { x: 0, y: 0, w: 40, h: 40 }, 'w'), name: 'codecolony' },
    node('r/m', 'module', { x: 1, y: 2, w: 20, h: 20 }, 'r'),
    node('r/m/a.ts', 'file', { x: 2, y: 3, w: 4, h: 4 }, 'r/m'),
    node('r/m/b.ts', 'file', { x: 8, y: 3, w: 4, h: 4 }, 'r/m'),
  ],
  edges: [],
} satisfies World)

const VIEW = { width: 800, height: 600 }

type Colonist = PlacedColonist['colonist']

function colonist(id: string, label: string, changes: Colonist['changes']): Colonist {
  return {
    id,
    repoId: 'r',
    label,
    status: 'working',
    session: 'firstmate',
    copy: id,
    head: 'abc1234',
    base: 'main',
    changes,
    omitted: 0,
  }
}

function camera(scale: number): Camera {
  const made = new Camera()
  made.scale = scale
  return made
}

// The blocks render would draw at this scale, with r/m open as given and
// its files drawn at that alpha.
function frame(scale: number, open: number): Drawn[] {
  return ['r', 'r/m', 'r/m/a.ts', 'r/m/b.ts'].map((id) => {
    const item = scene.byId.get(id) as WorldNode
    const { x, y, w, h } = item.rect
    const isFile = item.kind === 'file'
    return {
      node: item,
      x: x * scale,
      y: y * scale,
      w: w * scale,
      h: h * scale,
      alpha: isFile ? open : 1,
      open: item.kind === 'repo' ? 1 : isFile ? 0 : open,
    }
  })
}

const PINS = colonist('/pins', 'codecolony-colonist-pins', [
  { path: 'm/a.ts', kind: 'modified', units: 1 },
  { path: 'm/b.ts', kind: 'removed', units: 1 },
])
const QUEUE = colonist('/queue', 'codecolony-build-queue', [
  { path: 'm/a.ts', kind: 'modified', units: 1 },
])

describe('layoutPins', () => {
  it('puts a pin with the initials over the top right of every changed file', () => {
    const placed = placeColonists(scene, [PINS])
    const { pins, badges } = layoutPins(placed, scene, camera(10), VIEW, frame(10, 1))
    expect(pins.map((pin) => [pin.nodeId, pin.text, pin.path])).toEqual([
      ['r/m/a.ts', 'CP', 'm/a.ts'],
      ['r/m/b.ts', 'CP', 'm/b.ts'],
    ])
    // a.ts spans 20..60 across from 30 down: the pin ends at its right edge
    // and points just inside its top.
    const [first] = pins
    expect(first?.head.x).toBeCloseTo(60 - (first?.head.w ?? 0))
    expect(first?.tipY).toBe(31)
    expect(badges).toEqual([])
  })

  it('keeps a pin on every file inside a closed folder', () => {
    const placed = placeColonists(scene, [PINS])
    const { pins } = layoutPins(placed, scene, camera(10), VIEW, frame(10, 0.2))
    expect(pins.map((pin) => [pin.nodeId, pin.text])).toEqual([
      ['r/m/a.ts', 'CP'],
      ['r/m/b.ts', 'CP'],
    ])
  })

  it('gives N changed files at mixed depths exactly N pins at every zoom', () => {
    const deep = new Scene({
      ...scene.world,
      nodes: [
        ...scene.world.nodes,
        node('r/m/n', 'module', { x: 2, y: 9, w: 12, h: 12 }, 'r/m'),
        node('r/m/n/o', 'module', { x: 3, y: 10, w: 8, h: 8 }, 'r/m/n'),
        node('r/m/n/o/c.ts', 'file', { x: 4, y: 11, w: 2, h: 2 }, 'r/m/n/o'),
        node('r/m/n/d.ts', 'file', { x: 12, y: 10, w: 1, h: 1 }, 'r/m/n'),
      ],
    })
    const many = colonist('/many', 'codecolony-many', [
      { path: 'm/a.ts', kind: 'modified', units: 1 },
      { path: 'm/n/o/c.ts', kind: 'modified', units: 1 },
      { path: 'm/n/d.ts', kind: 'removed', units: 1 },
      { path: 'm/n/o/new.ts', kind: 'added', units: 1 },
    ])
    const placed = placeColonists(deep, [many])
    for (const scale of [0.5, 2, 5, 20]) {
      // Only the repository is drawn when zoomed all the way out.
      const drawn = frame(scale, 0).filter((item) => scale > 1 || item.node.kind === 'repo')
      const { pins } = layoutPins(placed, deep, camera(scale), VIEW, drawn)
      expect(pins.map((pin) => pin.path).sort()).toEqual([
        'm/a.ts',
        'm/n/d.ts',
        'm/n/o/c.ts',
        'm/n/o/new.ts',
      ])
      expect(new Set(pins.map((pin) => pin.text))).toEqual(new Set([placed[0]?.initials]))
    }
  })

  it('sets the pins of colonists on one file side by side with a conflict badge', () => {
    const placed = placeColonists(scene, [PINS, QUEUE])
    const { pins, badges } = layoutPins(placed, scene, camera(10), VIEW, frame(10, 1))
    const onA = pins.filter((pin) => pin.nodeId === 'r/m/a.ts')
    expect(onA.map((pin) => [pin.colonistId, pin.text, pin.isShared])).toEqual([
      ['/pins', 'CP', true],
      ['/queue', 'BQ', true],
    ])
    // In roster order, right to left, apart.
    const [pinsHead, queueHead] = onA.map((pin) => pin.head)
    expect((queueHead?.x ?? 0) + (queueHead?.w ?? 0)).toBeLessThan(pinsHead?.x ?? 0)
    expect(pins.find((pin) => pin.nodeId === 'r/m/b.ts')?.isShared).toBe(false)
    expect(badges).toHaveLength(1)
    expect(badges[0]).toMatchObject({
      nodeId: 'r/m/a.ts',
      colonistIds: ['/pins', '/queue'],
      paths: ['m/a.ts'],
    })
    expect(badges[0]?.x).toBeLessThan(queueHead?.x ?? 0)
  })

  it('keeps the conflict badge on the shared file inside a closed folder', () => {
    const placed = placeColonists(scene, [PINS, QUEUE])
    const { pins, badges } = layoutPins(placed, scene, camera(10), VIEW, frame(10, 0.2))
    expect(pins.map((pin) => [pin.nodeId, pin.text])).toEqual([
      ['r/m/a.ts', 'CP'],
      ['r/m/a.ts', 'BQ'],
      ['r/m/b.ts', 'CP'],
    ])
    expect(badges.map((badge) => badge.nodeId)).toEqual(['r/m/a.ts'])
  })

  it('leaves colonists on different files of a folder without a badge', () => {
    const other = colonist('/other', 'codecolony-other', [
      { path: 'm/b.ts', kind: 'modified', units: 1 },
    ])
    const only = colonist('/only', 'codecolony-only', [
      { path: 'm/a.ts', kind: 'modified', units: 1 },
    ])
    const placed = placeColonists(scene, [only, other])
    const { pins, badges } = layoutPins(placed, scene, camera(10), VIEW, frame(10, 0.2))
    expect(pins.map((pin) => pin.nodeId)).toEqual(['r/m/a.ts', 'r/m/b.ts'])
    expect(badges).toEqual([])
  })

  it('pins an added file on its placeholder, in the folder it is added to', () => {
    const adds = colonist('/adds', 'codecolony-adds', [
      { path: 'm/new.ts', kind: 'added', units: 4 },
    ])
    const placed = placeColonists(scene, [adds])
    const placeholder = placed[0]?.changes[0]?.placeholder as Rect
    const { pins } = layoutPins(placed, scene, camera(10), VIEW, frame(10, 1))
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ nodeId: 'r/m', text: 'AD', path: 'm/new.ts' })
    expect((pins[0]?.head.x ?? 0) + (pins[0]?.head.w ?? 0)).toBeCloseTo(
      (placeholder.x + placeholder.w) * 10,
    )
  })

  it('pins an added file with no room for a placeholder on its folder', () => {
    // r/f's content area is all taken by c.ts.
    const full = new Scene({
      ...scene.world,
      nodes: [
        ...scene.world.nodes,
        node('r/f', 'module', { x: 22, y: 2, w: 6, h: 6 }, 'r'),
        node('r/f/c.ts', 'file', { x: 22, y: 2, w: 6, h: 6 }, 'r/f'),
      ],
    })
    const adds = colonist('/adds', 'codecolony-adds', [
      { path: 'f/c.ts', kind: 'modified', units: 1 },
      { path: 'f/new.ts', kind: 'added', units: 1 },
    ])
    const placed = placeColonists(full, [adds])
    expect(placed[0]?.changes[1]?.placeholder).toBeUndefined()
    for (const scale of [0.5, 10]) {
      const { pins } = layoutPins(placed, full, camera(scale), VIEW, [])
      expect(pins.map((pin) => [pin.nodeId, pin.path])).toEqual([
        ['r/f/c.ts', 'f/c.ts'],
        ['r/f', 'f/new.ts'],
      ])
    }
  })

  it('leaves out pins on blocks off screen', () => {
    const placed = placeColonists(scene, [PINS])
    const far = camera(10)
    far.x = 500
    const drawn = frame(10, 1).map((item) => ({ ...item, x: item.x - 5000 }))
    expect(layoutPins(placed, scene, far, VIEW, drawn).pins).toEqual([])
  })

  it("lifts a row of pins that would cover another block's pins", () => {
    // b.ts sits half a unit right of a.ts: at 5px a unit their pins are
    // 2.5px apart.
    const both = colonist('/both', 'codecolony-both-files', [
      { path: 'm/a.ts', kind: 'modified', units: 1 },
      { path: 'm/b.ts', kind: 'modified', units: 1 },
    ])
    const tight = new Scene({
      ...scene.world,
      nodes: scene.world.nodes.map((item) =>
        item.id === 'r/m/b.ts' ? { ...item, rect: { x: 6.5, y: 3, w: 4, h: 4 } } : item,
      ),
    })
    const placed = placeColonists(tight, [both, PINS])
    const drawn = frame(5, 1).map((item) => {
      const node = tight.byId.get(item.node.id) as WorldNode
      return { ...item, node, x: node.rect.x * 5, w: node.rect.w * 5 }
    })
    const { pins } = layoutPins(placed, tight, camera(5), VIEW, drawn)
    const heads = pins.map((pin) => pin.head)
    for (const [i, a] of heads.entries()) {
      for (const b of heads.slice(i + 1)) {
        const isApart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(isApart).toBe(true)
      }
    }
    // Every pin still points at the top of its own file.
    expect(new Set(pins.map((pin) => pin.tipY))).toEqual(new Set([16]))
  })
})
