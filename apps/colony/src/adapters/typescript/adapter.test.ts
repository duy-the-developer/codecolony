import { describe, expect, it } from 'vitest'
import { resolveTsServerMemoryMb } from './adapter.ts'

const GB = 1024 ** 3

describe('resolveTsServerMemoryMb', () => {
  it('allows half of the machine memory', () => {
    expect(resolveTsServerMemoryMb(16 * GB)).toBe(8192)
  })

  it('stays within 3 GB and 12 GB', () => {
    expect(resolveTsServerMemoryMb(4 * GB)).toBe(3072)
    expect(resolveTsServerMemoryMb(64 * GB)).toBe(12_288)
  })
})
