import { describe, expect, it } from 'vitest'
import { parseLsofCwds } from './process-sessions.ts'

describe('parseLsofCwds', () => {
  it('reads the working folder of each agent process', () => {
    const output = [
      'p12',
      'cclaude',
      'fcwd',
      'n/work/a',
      'p13',
      'cvim',
      'fcwd',
      'n/work/b',
      'p14',
      'ccodex',
      'fcwd',
      'n/work/c',
      '',
    ].join('\n')
    expect(parseLsofCwds(output)).toEqual([
      { cwd: '/work/a', agent: 'claude' },
      { cwd: '/work/c', agent: 'codex' },
    ])
  })
})
