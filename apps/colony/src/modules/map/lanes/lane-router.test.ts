import { describe, expect, it } from 'vitest'
import { answerLaneRequest, toTransfer } from './lane-router.ts'
import { LaneWorld } from './lane-world.ts'

describe('toTransfer', () => {
  it('leaves a level the world keeps whole when its reply is posted', () => {
    const lanes = new LaneWorld(
      [
        { id: 'world', kind: 'world', rect: { x: 0, y: 0, w: 10, h: 10 } },
        { id: 'a', parent: 'world', kind: 'module', rect: { x: 1, y: 1, w: 3, h: 3 } },
        { id: 'a/f.ts', parent: 'a', kind: 'file', rect: { x: 2, y: 2, w: 1, h: 1 } },
      ],
      [['a/f.ts', 'a/f.ts']],
    )
    const world = { version: 1, lanes }
    const ask = () =>
      answerLaneRequest(world, { op: 'level', id: 0, version: 1, key: 'k', open: [] })
    for (let i = 0; i < 2; i++) {
      const sent = toTransfer(ask())
      // What postMessage does with the transfer list.
      const received = structuredClone(sent.reply, { transfer: sent.transfer })
      expect(received.level?.linkOfEdge).toEqual(Int32Array.from([-1]))
    }
    expect(ask().level?.linkOfEdge.length).toBe(1)
  })
})
