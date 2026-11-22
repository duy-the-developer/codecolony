import { describe, expect, it } from 'vitest'
import { readFirstmateTasks } from './firstmate-tasks.ts'
import {
  captainHoldLine,
  makeFirstmateHome,
  writeBacklog,
} from './testing/firstmate-home-fixture.ts'

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

  it('marks the tasks the backlog holds for the captain', async () => {
    const home = makeFirstmateHome([
      { id: 'held', meta: { kind: 'ship' } },
      { id: 'answered', meta: { kind: 'ship' } },
      { id: 'free', meta: { kind: 'ship' } },
    ])
    writeBacklog(
      home,
      [
        '## In flight',
        captainHoldLine('held', 'Approve the mockup'),
        '- [ ] free - Not held (repo: repo) (kind: ship)',
        '## Done',
        captainHoldLine('answered', 'Already answered'),
      ].join('\n'),
    )
    const tasks = await readFirstmateTasks(home)
    expect(tasks.map((task) => [task.id, task.captainHold])).toEqual([
      ['answered', undefined],
      ['free', undefined],
      ['held', { reason: 'Approve the mockup' }],
    ])
  })

  it('reads a missing home as no tasks', async () => {
    expect(await readFirstmateTasks('/no/such/home')).toEqual([])
  })
})
