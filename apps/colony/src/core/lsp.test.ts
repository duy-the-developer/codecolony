import { describe, expect, it } from 'vitest'
import { resolveLspMemoryBudget } from './lsp.ts'

const GB = 1024 ** 3

describe('resolveLspMemoryBudget', () => {
  it('splits half of the machine memory across four servers', () => {
    expect(resolveLspMemoryBudget(64 * GB)).toEqual({ sessions: 4, serverMemoryMb: 8192 })
  })

  it('keeps fewer servers open rather than giving one less than 3 GB', () => {
    expect(resolveLspMemoryBudget(16 * GB)).toEqual({ sessions: 2, serverMemoryMb: 3072 })
    expect(resolveLspMemoryBudget(4 * GB)).toEqual({ sessions: 1, serverMemoryMb: 3072 })
  })
})
