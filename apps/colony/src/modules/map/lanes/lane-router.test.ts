import { describe, expect, it } from 'vitest'
import { answerLaneRequest, toTransfer } from './lane-router.ts'
import { LaneWorld } from './lane-world.ts'

describe('toTransfer', () => {
  it('leaves the lines the world keeps whole when their reply is posted', () => {
    const lanes = new LaneWorld(
      [
        { id: 'world', kind: 'world', rect: { x: 0, y: 0, w: 20, h: 10 } },
        { id: 'a', parent: 'world', kind: 'module', rect: { x: 1, y: 1, w: 4, h: 4 } },
        { id: 'a/f.ts', parent: 'a', kind: 'file', rect: { x: 2, y: 3, w: 1, h: 1 } },
        { id: 'b', parent: 'world', kind: 'module', rect: { x: 10, y: 1, w: 4, h: 4 } },
        { id: 'b/g.ts', parent: 'b', kind: 'file', rect: { x: 11, y: 3, w: 1, h: 1 } },
      ],
      [['a/f.ts', 'b/g.ts']],
    )
    const world = { version: 1, lanes }
    const ask = () => answerLaneRequest(world, { op: 'files', id: 0, version: 1 })
    const points = [...(ask().files?.routes.points ?? [])]
    expect(points.length).toBeGreaterThan(0)
    for (let i = 0; i < 2; i++) {
      const sent = toTransfer(ask())
      // What postMessage does with the transfer list.
      const received = structuredClone(sent.reply, { transfer: sent.transfer })
      expect(received.files?.edges).toEqual(Int32Array.from([0]))
      expect([...(received.files?.routes.points ?? [])]).toEqual(points)
    }
    expect([...(ask().files?.routes.points ?? [])]).toEqual(points)
  })
})
