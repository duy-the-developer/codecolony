import { describe, expect, it } from 'vitest'
import { readFirstmateTasks } from './firstmate-tasks.ts'
import { makeFirstmateHome } from './testing/firstmate-home-fixture.ts'

describe('readFirstmateTasks', () => {
  it('reads each task record with its status log, as the build queue reads it', async () => {
    const home = makeFirstmateHome([
      {
        id: 'colonists-build',
        meta: { worktree: '/slots/2/repo', kind: 'ship', branch: 'fm/colonists-build' },
        status: [
          'working [at=1]: setup done',
          'done [at=2]: PR https://github.com/o/r/pull/9 checks green',
          'needs-decision [key=a] [at=3]: merge now?',
          'working [at=4]: meanwhile, tidying',
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
        status: {
          state: 'waiting',
          note: 'merge now?',
          pullRequestUrl: 'https://github.com/o/r/pull/9',
        },
      },
      { id: 'quiet', kind: 'scout' },
    ])
  })

  it('reads a missing home as no tasks', async () => {
    expect(await readFirstmateTasks('/no/such/home')).toEqual([])
  })
})
