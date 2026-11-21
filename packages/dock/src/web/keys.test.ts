import { describe, expect, it } from 'vitest'
import { type KeyInput, keySequence, SHIFT_ENTER } from './keys.ts'

const key = (init: Partial<KeyInput> & Pick<KeyInput, 'key'>): KeyInput => ({
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  ...init,
})

describe('keySequence', () => {
  it('sends ESC CR for Shift+Enter', () => {
    expect(keySequence(key({ key: 'Enter', shiftKey: true }))).toBe('\x1b\r')
    expect(SHIFT_ENTER).toBe('\x1b\r')
  })

  it('leaves plain Enter to xterm.js, which sends CR to submit', () => {
    expect(keySequence(key({ key: 'Enter' }))).toBeNull()
  })

  it.each([
    ['Alt', { altKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])('leaves Shift+%s+Enter to xterm.js', (_, modifier) => {
    expect(keySequence(key({ key: 'Enter', shiftKey: true, ...modifier }))).toBeNull()
  })

  it('leaves other keys and IME composition alone', () => {
    expect(keySequence(key({ key: 'a', shiftKey: true }))).toBeNull()
    expect(keySequence(key({ key: 'Enter', shiftKey: true, isComposing: true }))).toBeNull()
  })
})
