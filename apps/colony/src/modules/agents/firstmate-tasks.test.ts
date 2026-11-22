import { describe, expect, it } from 'vitest'
import { findPullRequestUrl, parseStatusLine, readFirstmateTasks } from './firstmate-tasks.ts'
import { makeFirstmateHome } from './testing/firstmate-home-fixture.ts'

describe('parseStatusLine', () => {
  it('reads the state, its time and the text', () => {
    expect(parseStatusLine('needs-decision [key=nm-1] [at=1795003844]: pick one')).toEqual({
      state: 'needs-decision',
      at: 1795003844,
      text: 'pick one',
    })
    expect(parseStatusLine('working: started')).toEqual({ state: 'working', text: 'started' })
    expect(parseStatusLine('not a status line')).toBeUndefined()
  })
})

describe('findPullRequestUrl', () => {
  it('finds the last pull request URL in a text', () => {
    expect(
      findPullRequestUrl(
        'PR https://github.com/o/r/pull/41 then https://github.com/o/r/pull/42 checks green',
      ),
    ).toBe('https://github.com/o/r/pull/42')
    expect(findPullRequestUrl('no link')).toBeUndefined()
  })
})

describe('readFirstmateTasks', () => {
  it('reads each task record with its last status line and newest pull request', async () => {
    const home = makeFirstmateHome([
      {
        id: 'colonists-build',
        meta: { worktree: '/slots/2/repo', kind: 'ship', branch: 'fm/colonists-build' },
        status: [
          'working [at=1]: setup done',
          'done [at=2]: PR https://github.com/o/r/pull/9 checks green',
          'resolved [at=3]: answered',
        ],
      },
      { id: 'quiet', meta: { kind: 'scout' } },
    ])
    expect(await readFirstmateTasks(home)).toEqual([
      {
        id: 'colonists-build',
        worktree: '/slots/2/repo',
        kind: 'ship',
        branch: 'fm/colonists-build',
        status: { state: 'resolved', at: 3, text: 'answered' },
        pr: 'https://github.com/o/r/pull/9',
      },
      { id: 'quiet', kind: 'scout' },
    ])
  })

  it('reads a missing home as no tasks', async () => {
    expect(await readFirstmateTasks('/no/such/home')).toEqual([])
  })
})
