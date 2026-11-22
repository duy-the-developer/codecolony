import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { git, makeRepo, makeTempDir } from '../indexing/testing/git-fixture.ts'
import type { ColonistsResponse } from '../wire/api-types.ts'
import { createColonistTracker } from './colonist-tracker.ts'
import type { LiveSession } from './session-source.ts'
import {
  captainHoldLine,
  makeFirstmateHome,
  writeBacklog,
  writeTask,
} from './testing/firstmate-home-fixture.ts'

// Your clone of the repository is on the map. Firstmate works from its own
// clone, with a worktree per task in a pool of slots.
function makeColony() {
  const mine = makeRepo({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n' })
  const home = makeFirstmateHome()
  const clone = join(home, 'projects', 'repo')
  git(mine, 'clone', '-q', mine, clone)
  const slots = makeTempDir('codecolony-slots-')
  const slot = (n: number) => {
    const path = join(slots, String(n), 'repo')
    mkdirSync(join(slots, String(n)), { recursive: true })
    git(clone, 'worktree', 'add', '-q', '-b', `fm/task-${n}`, path)
    return path
  }
  return { mine, home, clone, slot }
}

const repos = (root: string) => () => [{ id: 'project:demo/repo', root }]

describe('createColonistTracker', () => {
  it('finds the worktrees of firstmate clones by repository identity', async () => {
    const { mine, home, slot } = makeColony()
    const busy = slot(1)
    const parked = slot(2)
    slot(3)
    writeFileSync(join(busy, 'src', 'a.ts'), 'a2\n')
    mkdirSync(join(busy, 'src', 'queue'))
    writeFileSync(join(busy, 'src', 'queue', 'read.ts'), 'x\n')
    writeFileSync(join(parked, 'src', 'b.ts'), 'b2\n')
    writeTask(home, {
      id: 'task-1',
      meta: { worktree: busy, kind: 'ship', branch: 'fm/task-1' },
      status: ['working [at=1]: adding the queue reader'],
    })
    const sessions: LiveSession[] = [{ cwd: join(busy, 'src'), agent: 'claude' }]
    const tracker = createColonistTracker({
      listRepos: repos(mine),
      sessions: [{ name: 'fake', listSessions: () => Promise.resolve(sessions) }],
      firstmateHome: home,
      home: '/nowhere',
    })
    await tracker.refresh({ discover: true })

    const { colonists } = tracker.snapshot
    expect(colonists).toHaveLength(2)
    expect(colonists[0]).toMatchObject({
      repoId: 'project:demo/repo',
      label: 'task-1',
      task: 'task-1',
      status: 'working',
      session: 'firstmate',
      agent: 'claude',
      note: 'adding the queue reader',
      branch: 'fm/task-1',
      base: 'main',
      changes: [
        { path: 'src/a.ts', kind: 'modified', units: 1 },
        { path: 'src/queue/read.ts', kind: 'added', units: 1 },
      ],
    })
    // Changes but nobody at work: grey.
    expect(colonists[1]).toMatchObject({
      label: expect.stringMatching(/^codecolony-slots-.+\/2 · fm\/task-2$/),
      status: 'idle',
      session: 'none',
      changes: [{ path: 'src/b.ts', kind: 'modified', units: 1 }],
    })
    tracker.close()
  })

  it('shows a task held for the captain as waiting on you with no live session', async () => {
    const { mine, home, slot } = makeColony()
    const held = slot(1)
    writeFileSync(join(held, 'src', 'a.ts'), 'a2\n')
    writeTask(home, {
      id: 'task-1',
      meta: { worktree: held, kind: 'ship', branch: 'fm/task-1' },
      status: ['paused [at=1]: waiting on the captain'],
    })
    writeBacklog(home, `## In flight\n${captainHoldLine('task-1', 'Approve the mockup')}\n`)
    const tracker = createColonistTracker({
      listRepos: repos(mine),
      sessions: [{ name: 'fake', listSessions: () => Promise.resolve([]) }],
      firstmateHome: home,
      home: '/nowhere',
    })
    await tracker.refresh({ discover: true })
    expect(tracker.snapshot.colonists).toEqual([
      expect.objectContaining({
        task: 'task-1',
        status: 'waiting',
        session: 'none',
        note: 'Approve the mockup',
      }),
    ])
    tracker.close()
  })

  it('counts your own clone, and announces each change once', async () => {
    const { mine } = makeColony()
    const tracker = createColonistTracker({ listRepos: repos(mine), home: '/nowhere' })
    const seen: ColonistsResponse[] = []
    tracker.onChange((snapshot) => seen.push(snapshot))
    await tracker.refresh({ discover: true })
    expect(tracker.snapshot.colonists).toEqual([])
    expect(seen).toEqual([])

    writeFileSync(join(mine, 'src', 'b.ts'), 'b2\n')
    await tracker.refresh()
    await tracker.refresh()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.version).toBe(1)
    expect(seen[0]?.colonists[0]).toMatchObject({
      status: 'idle',
      branch: 'main',
      changes: [{ path: 'src/b.ts', kind: 'modified', units: 1 }],
    })
    tracker.close()
  })

  it('follows the file a colonist saved last, even when its status does not change', async () => {
    const { mine, home, slot } = makeColony()
    const busy = slot(1)
    writeFileSync(join(busy, 'src', 'a.ts'), 'a2\n')
    writeFileSync(join(busy, 'src', 'b.ts'), 'b2\n')
    utimesSync(join(busy, 'src', 'a.ts'), 2000, 2000)
    utimesSync(join(busy, 'src', 'b.ts'), 1000, 1000)
    const tracker = createColonistTracker({
      listRepos: repos(mine),
      firstmateHome: home,
      home: '/nowhere',
    })
    await tracker.refresh({ discover: true })
    expect(tracker.snapshot.colonists[0]?.lastSaved).toBe('src/a.ts')

    // Saving b.ts again leaves git status as it was.
    const version = tracker.snapshot.version
    utimesSync(join(busy, 'src', 'b.ts'), 3000, 3000)
    await tracker.refresh()
    expect(tracker.snapshot.colonists[0]?.lastSaved).toBe('src/b.ts')
    expect(tracker.snapshot.version).toBe(version + 1)
  })

  it('ignores clones of other repositories', async () => {
    const { mine } = makeColony()
    const other = makeRepo({ 'x.ts': 'x\n' })
    writeFileSync(join(other, 'x.ts'), 'x2\n')
    const tracker = createColonistTracker({
      listRepos: repos(mine),
      sessions: [{ name: 'fake', listSessions: () => Promise.resolve([{ cwd: other }]) }],
      home: '/nowhere',
    })
    await tracker.refresh({ discover: true })
    expect(tracker.snapshot.colonists).toEqual([])
    tracker.close()
  })
})
