import { describe, expect, it } from 'vitest'
import { parseWorktreeList } from './worktree-list.ts'

describe('parseWorktreeList', () => {
  it('reads each checkout with its head and branch, and skips bare and prunable ones', () => {
    const output = [
      'worktree /repo',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /slots/1/repo',
      'HEAD bbb',
      'detached',
      '',
      'worktree /bare',
      'bare',
      '',
      'worktree /gone',
      'HEAD ccc',
      'prunable gitdir file points to non-existent location',
      '',
      '',
    ].join('\0')
    expect(parseWorktreeList(output)).toEqual([
      { path: '/repo', head: 'aaa', branch: 'main' },
      { path: '/slots/1/repo', head: 'bbb' },
    ])
  })
})
