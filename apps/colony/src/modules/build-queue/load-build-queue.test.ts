import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadBuildQueue, loadOrderChanges, type QueueProject } from './load-build-queue.ts'
import { FAKE_BACKLOG, makeFirstmateHome, writeWorker } from './testing/firstmate-home-fixture.ts'

const PR = 'https://github.com/acme/app/pull/64'
const PROJECTS: QueueProject[] = [{ name: 'app', root: '/nowhere/app', kind: 'repo' }]

function git(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { encoding: 'utf8' },
  )
}

// A repository on main with a worker branch that commits, edits and adds.
function makeWorkerCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codecolony-worker-'))
  git(dir, 'init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'initial')
  git(dir, 'checkout', '-q', '-b', 'fm/work')
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2\n')
  git(dir, 'commit', '-q', '-am', 'committed change')
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 2\n')
  writeFileSync(join(dir, 'src', 'c.ts'), 'export const c = 1\n')
  return dir
}

describe('loadBuildQueue', () => {
  it("lists the map's orders, Active sorted by state, with workers' state and notes", async () => {
    const home = makeFirstmateHome({
      backlog: FAKE_BACKLOG,
      workers: {
        'app-colonists': { status: ['working [at=1]: reading the design'] },
        'app-queue': { status: [`done [at=2]: PR ${PR} checks green`] },
      },
    })
    const orders = await loadBuildQueue(home, PROJECTS)
    expect(orders.map((order) => [order.section, order.id, order.state])).toEqual([
      ['active', 'app-roadmap', 'waiting'],
      ['active', 'app-queue', 'pr-ready'],
      ['active', 'app-colonists', 'working'],
      ['queued', 'app-wiring', 'queued'],
      ['done', 'app-selection', 'done'],
      ['done', 'app-mockup', 'done'],
    ])
    expect(orders.find((order) => order.id === 'app-queue')).toEqual({
      id: 'app-queue',
      title: 'App: build queue (#44)',
      section: 'active',
      state: 'pr-ready',
      project: 'app',
      kind: 'ship',
      colonist: 'app-queue',
      pullRequestUrl: PR,
      note: `PR ${PR} checks green`,
      date: '2026-11-22',
      hasWorktree: false,
    })
  })

  it('explains held orders by their hold reason', async () => {
    const home = makeFirstmateHome({ backlog: FAKE_BACKLOG })
    const orders = await loadBuildQueue(home, PROJECTS)
    const byId = new Map(orders.map((order) => [order.id, order]))
    expect(byId.get('app-roadmap')).toMatchObject({
      state: 'waiting',
      kind: 'captain',
      note: 'Approve the C1-C13 order',
    })
    expect(byId.get('app-roadmap')?.colonist).toBeUndefined()
    expect(byId.get('app-wiring')?.note).toBe('Held until you approve the mockup')
    expect(byId.get('app-selection')).toMatchObject({
      date: '2026-11-22',
      pullRequestUrl: 'https://github.com/acme/app/pull/63',
    })
  })

  it('finds a repository inside a folder-of-repositories project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codecolony-org-'))
    mkdirSync(join(root, 'app'))
    const home = makeFirstmateHome({ backlog: FAKE_BACKLOG })
    const orders = await loadBuildQueue(home, [{ name: 'org', root, kind: 'repos' }])
    expect(orders.length).toBeGreaterThan(0)
    expect(new Set(orders.map((order) => order.project))).toEqual(new Set(['org']))
  })

  it('is empty without a backlog', async () => {
    expect(await loadBuildQueue(makeFirstmateHome(), PROJECTS)).toEqual([])
  })
})

describe('loadOrderChanges', () => {
  it("lists the worker's committed, uncommitted and new files against main", async () => {
    const worktree = makeWorkerCopy()
    const home = makeFirstmateHome({ backlog: FAKE_BACKLOG })
    writeWorker(home, 'app-colonists', { meta: { worktree }, status: ['working [at=1]: on it'] })
    const [order] = (await loadBuildQueue(home, PROJECTS)).filter((o) => o.id === 'app-colonists')
    expect(order?.hasWorktree).toBe(true)
    expect(await loadOrderChanges(home, PROJECTS, 'app-colonists')).toEqual({
      project: 'app',
      repo: 'app',
      paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    })
  })

  it('has nothing for an order without a worker copy or a bad id', async () => {
    const home = makeFirstmateHome({ backlog: FAKE_BACKLOG })
    writeWorker(home, 'app-queue', { meta: { worktree: '/nowhere/copy' } })
    expect(await loadOrderChanges(home, PROJECTS, 'app-queue')).toBeUndefined()
    expect(await loadOrderChanges(home, PROJECTS, 'app-roadmap')).toBeUndefined()
    expect(await loadOrderChanges(home, PROJECTS, '../etc')).toBeUndefined()
  })
})
