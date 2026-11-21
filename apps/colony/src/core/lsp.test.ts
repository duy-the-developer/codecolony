import { describe, expect, it } from 'vitest'
import { resolveLspMemoryBudget } from './lsp.ts'

const GB = 1024 ** 3

describe('resolveLspMemoryBudget', () => {
  it('splits half of the machine memory across at most four servers', () => {
    expect(resolveLspMemoryBudget(64 * GB)).toEqual({ sessions: 4, serverMemoryMb: 8192 })
    expect(resolveLspMemoryBudget(128 * GB)).toEqual({ sessions: 4, serverMemoryMb: 16_384 })
  })

  it('keeps fewer servers open so each has room for a large project', () => {
    expect(resolveLspMemoryBudget(32 * GB)).toEqual({ sessions: 2, serverMemoryMb: 8192 })
    expect(resolveLspMemoryBudget(16 * GB)).toEqual({ sessions: 1, serverMemoryMb: 8192 })
    expect(resolveLspMemoryBudget(8 * GB)).toEqual({ sessions: 1, serverMemoryMb: 4096 })
  })
})
