import { describe, expect, it, vi } from 'vitest'
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

// world > repo r > module m > a.ts, b.ts
const scene = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node('w', 'world', { x: 0, y: 0, w: 40, h: 40 }),
    node('r', 'repo', { x: 0, y: 0, w: 40, h: 40 }, 'w'),
    node('m', 'module', { x: 1, y: 2, w: 20, h: 20 }, 'r'),
    node('m/a.ts', 'file', { x: 2, y: 3, w: 4, h: 4 }, 'm'),
    node('m/b.ts', 'file', { x: 10, y: 3, w: 4, h: 4 }, 'm'),
  ],
  edges: [],
} satisfies World)

const camera = new Camera()
camera.scale = 10

// Canvas calls, by name with their arguments, for the ones a test looks at.
type Call = [string, ...unknown[]]

// A 2D context that accepts every call, draws nothing and records them.
function recordingContext(calls: Call[] = []): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { canvas: { clientWidth: 800, clientHeight: 600 } }
  return new Proxy(state, {
    get: (target, key) => {
      if (key in target) return target[key as string]
      if (key === 'measureText') return () => ({ width: 10 })
      if (key === 'getTransform') return () => ({ a: 1 })
      return (...args: unknown[]) => calls.push([String(key), ...args])
    },
    set: (target, key, value) => {
      target[key as string] = value
      calls.push([`set ${String(key)}`, value])
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

const ctx = recordingContext()

// The robots' glyphs are Path2D objects, which Node does not have.
vi.stubGlobal('Path2D', class {})

function drawn(id: string, alpha: number, open: number): Drawn {
  const item = scene.byId.get(id) as WorldNode
  const { x, y, w, h } = item.rect
  return {
    node: item,
    x: (x - camera.x) * camera.scale,
    y: (y - camera.y) * camera.scale,
    w: w * camera.scale,
    h: h * camera.scale,
    alpha,
    open,
  }
}

function placed(
  id: string,
  initials: string,
  { files = ['a.ts'], lastSaved }: { files?: string[]; lastSaved?: string } = {},
): PlacedColonist {
  const colonist: PlacedColonist['colonist'] = {
    id,
    repoId: 'r',
    label: id,
    status: 'working',
    session: 'own',
    copy: id,
    head: 'abc1234',
    base: 'main',
    changes: files.map((path) => ({ path, kind: 'modified', units: 1 })),
    omitted: 0,
  }
  if (lastSaved) colonist.lastSaved = lastSaved
  return {
    colonist,
    initials,
    changes: files.map((path) => ({
      path,
      kind: 'modified',
      nodeId: `m/${path}`,
      holderId: `m/${path}`,
    })),
    folders: [],
    bounds: { x: 2, y: 3, w: 12, h: 4 },
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

const OPEN = [drawn('r', 1, 1), drawn('m', 1, 1), drawn('m/a.ts', 1, 0), drawn('m/b.ts', 1, 0)]

// Where a robot's chip is drawn over a file block spanning x0..x1 from y0
// down, at 10px a unit: centred, its 22px chip on an 8px stem from 1px in.
function chipOver(x0: number, x1: number, y0: number): [number, number] {
  return [(x0 + x1) / 2, y0 + 1 - 8 - 11]
}

// The number of dashed outlines drawn: each is a casing and a dashed stroke.
function countOutlines(calls: Call[]): number {
  return calls.filter(([name]) => name === 'strokeRect').length / 2
}

describe('ColonistLayer', () => {
  it('stands one robot on the file the colonist saved last, and finds it there', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O', { files: ['a.ts', 'b.ts'], lastSaved: 'b.ts' })])
    layer.drawChanges(ctx, scene, camera, OPEN)
    // a.ts spans 20..60 across, b.ts 100..140, both from 30 down.
    expect(layer.hitMarker(...chipOver(100, 140, 30))).toMatchObject({
      kind: 'robot',
      colonistId: '/one',
      robot: { path: 'b.ts' },
    })
    expect(layer.hitMarker(...chipOver(20, 60, 30))).toBeUndefined()
  })

  it('stands on its first change when it has no last-saved file', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O', { files: ['a.ts', 'b.ts'] })])
    layer.drawChanges(ctx, scene, camera, OPEN)
    expect(layer.hitMarker(...chipOver(20, 60, 30))).toMatchObject({ kind: 'robot' })
  })

  it('stands on the closed folder showing its file when the file is too faint', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O', { lastSaved: 'a.ts' })])
    layer.drawChanges(ctx, scene, camera, [drawn('r', 1, 1), drawn('m', 1, 0.2)])
    // The module spans 10..210 across from 20 down.
    expect(layer.hitMarker(...chipOver(10, 210, 20))).toMatchObject({ kind: 'robot' })
  })

  it('goes off screen with its file rather than onto a folder still on screen', () => {
    const off = new Camera()
    off.scale = 10
    off.x = 7
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O', { lastSaved: 'a.ts' })])
    const module = scene.byId.get('m') as WorldNode
    // a.ts is left of the screen; the module still spans -60..140 across.
    layer.drawChanges(ctx, scene, off, [
      { node: module, x: -60, y: 20, w: 200, h: 200, alpha: 1, open: 1 },
    ])
    expect(layer.hitMarker(...chipOver(-60, 140, 20))).toBeUndefined()
    expect(layer.hitMarker(...chipOver(-50, -10, 30))).toMatchObject({ kind: 'robot' })
  })

  it('draws no pins without the Owners overlay, and one per changed file with it', () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O', { files: ['a.ts', 'b.ts'], lastSaved: 'a.ts' })])
    layer.drawChanges(ctx, scene, camera, OPEN)
    expect(layer.pins.pins).toEqual([])
    layer.showOwners = true
    layer.drawChanges(ctx, scene, camera, OPEN)
    const { pins } = layer.pins
    expect(pins.map((pin) => [pin.nodeId, pin.text])).toEqual([
      ['m/a.ts', 'O'],
      ['m/b.ts', 'O'],
    ])
    // Each pin is found by its head, over its own file.
    for (const pin of pins) {
      const hit = layer.hitMarker(pin.head.x + pin.head.w / 2, pin.head.y + pin.head.h / 2)
      expect(hit).toMatchObject({ kind: 'pin', pin: { nodeId: pin.nodeId } })
    }
  })

  it('lifts a pin above the robot on the same file', () => {
    const layer = new ColonistLayer()
    layer.showOwners = true
    layer.setColonists([placed('/one', 'O', { lastSaved: 'a.ts' })])
    layer.drawChanges(ctx, scene, camera, OPEN)
    const [pin] = layer.pins.pins
    const [, chipY] = chipOver(20, 60, 30)
    expect(pin && pin.head.y + pin.head.h).toBeLessThan(chipY - 11)
    expect(pin?.tipY).toBe(31)
  })

  it('keeps the conflict badge on a shared file with the Owners overlay off', () => {
    const layer = new ColonistLayer()
    layer.setColonists(shared(placed('/one', 'O'), placed('/two', 'T')))
    layer.drawChanges(ctx, scene, camera, OPEN)
    expect(layer.pins.pins).toEqual([])
    const [badge] = layer.pins.badges
    expect(layer.hitMarker(badge?.x ?? 0, badge?.y ?? 0)).toMatchObject({
      kind: 'conflict',
      badge: { nodeId: 'm/a.ts', colonistIds: ['/one', '/two'] },
    })
  })

  it('stands a conflict badge with no pins on a stem down to its file', () => {
    const layer = new ColonistLayer()
    layer.setColonists(shared(placed('/one', 'O'), placed('/two', 'T')))
    layer.drawChanges(ctx, scene, camera, OPEN)
    const [badge] = layer.pins.badges
    expect(badge?.tipY).toBe(31)
    const calls: Call[] = []
    layer.drawMarkers(recordingContext(calls), { width: 800, height: 600 }, 0, true)
    const from = calls.findIndex(
      ([name, , y]) => name === 'moveTo' && y === Math.round((badge?.y ?? 0) + 7),
    )
    const [, x] = calls[from] as Call
    expect(Math.abs((x as number) - (badge?.x ?? 0))).toBeLessThanOrEqual(1)
    expect(x).toBeGreaterThanOrEqual(20)
    expect(x).toBeLessThanOrEqual(60)
    expect(calls[from + 1]).toEqual(['lineTo', x, 31])
  })

  it('stands two robots on the same small file, the later one lifted, both pointing at it', () => {
    const layer = new ColonistLayer()
    layer.setColonists([
      placed('/one', 'O', { lastSaved: 'a.ts' }),
      placed('/two', 'T', { lastSaved: 'a.ts' }),
    ])
    layer.drawChanges(ctx, scene, camera, OPEN)
    const calls: Call[] = []
    layer.drawMarkers(recordingContext(calls), { width: 800, height: 600 }, 0, true)
    const stems = calls.flatMap((call, i) =>
      call[0] === 'moveTo' ? [[call, calls[i + 1] as Call] as const] : [],
    )
    expect(stems).toHaveLength(2)
    for (const [from, to] of stems) {
      expect(from[1]).toBeGreaterThanOrEqual(20)
      expect(from[1]).toBeLessThanOrEqual(60)
      expect(to).toEqual(['lineTo', from[1], 31])
    }
    const [x, y] = chipOver(20, 60, 30)
    const below = layer.hitMarker(x, y)
    const above = layer.hitMarker(x, y - 32.5)
    expect(below).toMatchObject({ kind: 'robot' })
    expect(above).toMatchObject({ kind: 'robot' })
    expect(below?.kind === 'robot' && below.colonistId).not.toBe(
      above?.kind === 'robot' && above.colonistId,
    )
  })

  it('finds the conflict badge left of the pins of two colonists on one file', () => {
    const layer = new ColonistLayer()
    layer.showOwners = true
    layer.setColonists(shared(placed('/one', 'O'), placed('/two', 'T')))
    layer.drawChanges(ctx, scene, camera, OPEN)
    const [first, second] = layer.pins.pins
    const [badge] = layer.pins.badges
    expect([first?.colonistId, second?.colonistId]).toEqual(['/one', '/two'])
    expect((badge?.x ?? 0) < (second?.head.x ?? 0)).toBe(true)
    expect(layer.hitMarker((second?.head.x ?? 0) + 2, (second?.head.y ?? 0) + 2)).toMatchObject({
      colonistId: '/two',
    })
  })

  it("outlines every colonist's changes with the Git overlay, else only the picked one's", () => {
    const layer = new ColonistLayer()
    layer.setColonists([placed('/one', 'O'), placed('/two', 'T', { files: ['b.ts'] })])
    const draw = () => {
      const calls: Call[] = []
      layer.drawChanges(recordingContext(calls), scene, camera, OPEN)
      return countOutlines(calls)
    }
    expect(draw()).toBe(0)
    layer.selected = '/two'
    expect(draw()).toBe(1)
    layer.showGit = true
    expect(draw()).toBe(2)
    layer.selected = undefined
    expect(draw()).toBe(2)
  })

  it("dims the other colonists' outlines while one is picked", () => {
    const layer = new ColonistLayer()
    layer.showGit = true
    layer.setColonists([placed('/one', 'O'), placed('/two', 'T', { files: ['b.ts'] })])
    layer.selected = '/two'
    const calls: Call[] = []
    layer.drawChanges(recordingContext(calls), scene, camera, OPEN)
    const alphas = calls.filter(([name]) => name === 'set globalAlpha').map(([, value]) => value)
    // The others first, then the picked one on top at full strength.
    expect(alphas.slice(0, 2)).toEqual([0.35, 1])
  })

  it('joins robots and pins to their blocks with straight 1px lines, never a wedge', () => {
    const layer = new ColonistLayer()
    layer.showOwners = true
    layer.setColonists([placed('/one', 'O', { files: ['a.ts', 'b.ts'], lastSaved: 'a.ts' })])
    layer.drawChanges(ctx, scene, camera, OPEN)
    const calls: Call[] = []
    layer.drawMarkers(recordingContext(calls), { width: 800, height: 600 }, 0, true)
    const names = calls.map(([name]) => name)
    expect(names).not.toContain('closePath')
    const stems: Call[][] = []
    calls.forEach((call, i) => {
      if (call[0] === 'moveTo') stems.push([calls[i - 1] as Call, call, calls[i + 1] as Call])
    })
    // A robot and two pins.
    expect(stems).toHaveLength(3)
    for (const [, from, to] of stems) {
      expect(to?.[0]).toBe('lineTo')
      expect(to?.[1]).toBe(from?.[1])
    }
    const widths = calls
      .map((call, i) => [call, calls[i + 2]] as const)
      .filter(([call, next]) => call[0] === 'set lineWidth' && next?.[0] === 'moveTo')
      .map(([call]) => call[1])
    expect(widths).toEqual([1, 1, 1])
  })

  it('moves while a robot works or a colonist waits, and is still when all idle', () => {
    const layer = new ColonistLayer()
    const idle = placed('/one', 'O')
    idle.colonist.status = 'idle'
    layer.setColonists([idle])
    layer.drawChanges(ctx, scene, camera, OPEN)
    expect(layer.isAnimated).toBe(false)
    layer.setColonists([placed('/one', 'O')])
    layer.drawChanges(ctx, scene, camera, OPEN)
    expect(layer.isAnimated).toBe(true)
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
    layer.showOwners = true
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
      const hit = layer.hitMarker(pin.head.x + pin.head.w / 2, pin.head.y + pin.head.h / 2)
      expect(hit).toMatchObject({ kind: 'pin', colonistId: pin.colonistId })
    }
  })
})
