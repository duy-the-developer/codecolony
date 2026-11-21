import { describe, expect, it } from 'vitest'
import { isLoopbackHost } from './host.ts'

describe('isLoopbackHost', () => {
  it.each([
    '127.0.0.1',
    '127.0.0.1:4320',
    'localhost',
    'localhost:4320',
    'LOCALHOST:4320',
    '[::1]',
    '[::1]:4320',
  ])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each([
    undefined,
    '',
    'evil.example',
    'evil.example:4320',
    'localhost.evil.example',
    '127.0.0.1.evil.example',
    'evil.example@127.0.0.1',
    '0.0.0.0:4320',
    '::1',
    'localhost:',
  ])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})
