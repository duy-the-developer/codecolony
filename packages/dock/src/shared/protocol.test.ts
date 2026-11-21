import { describe, expect, it } from 'vitest'
import { encodeResize, isValidPaneId, parseControlMessage } from './protocol.ts'

describe('parseControlMessage', () => {
  it('reads a resize', () => {
    expect(parseControlMessage(encodeResize(120, 40))).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    })
  })

  it('accepts the size limits', () => {
    expect(parseControlMessage(encodeResize(1, 1000))).not.toBeNull()
  })

  it.each([
    ['malformed JSON', '{"type":"resize",'],
    ['a non-object', '"resize"'],
    ['null', 'null'],
    ['an unknown type', '{"type":"exec","cols":80,"rows":24}'],
    ['zero', '{"type":"resize","cols":0,"rows":24}'],
    ['over the limit', '{"type":"resize","cols":1001,"rows":24}'],
    ['a fraction', '{"type":"resize","cols":80.5,"rows":24}'],
    ['a string size', '{"type":"resize","cols":"80","rows":24}'],
    ['a missing size', '{"type":"resize","cols":80}'],
  ])('rejects %s', (_, raw) => {
    expect(parseControlMessage(raw)).toBeNull()
  })

  it('rejects NaN', () => {
    expect(
      parseControlMessage(JSON.stringify({ type: 'resize', cols: Number.NaN, rows: 24 })),
    ).toBe(null)
  })
})

describe('isValidPaneId', () => {
  it.each(['w1:p2', 'w12:p3', 'pane_1'])('accepts %s', (id) => {
    expect(isValidPaneId(id)).toBe(true)
  })

  it.each(['', ':p1', 'w1 p2', 'w1:p2\n', 'a'.repeat(65), 42, null])('rejects %j', (id) => {
    expect(isValidPaneId(id)).toBe(false)
  })
})
