import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ColonyConfig } from '../config/load-config.ts'
import type { World } from '../shared/world-types.ts'
import { commit, git, makeRepo, makeTempDir } from '../testing/git-fixture.ts'
import { Colony } from './colony.ts'

const colonies: Colony[] = []
afterEach(async () => {
  await Promise.all(colonies.splice(0).map((c) => c.close()))
})

function colonyFor(projects: ColonyConfig['projects'], cacheDir = makeTempDir()): Colony {
  const colony = new Colony({ projects, cacheDir, source: 'test', port: 0 })
  colonies.push(colony)
  return colony
}

// Indexed and watched, with the fallback check too slow to fire in a test.
async function watchedColony(projects: ColonyConfig['projects']): Promise<Colony> {
  const colony = colonyFor(projects)
  await colony.refresh()
  await colony.watch({ fallbackMs: 60_000, settleMs: 20 })
  return colony
}

function nextWorld(colony: Colony): Promise<World> {
  return new Promise((resolve) => colony.once('update', resolve))
}

function rects(world: World): Map<string, string> {
  return new Map(world.nodes.map((n) => [n.id, JSON.stringify(n.rect)]))
}

describe('Colony', () => {
  it('maps a repository: dirs, files, symbols and import edges', async () => {
    const root = makeRepo(
      {
        'src/a.ts': "import { b } from './b'\nexport const a = () => b()\n",
        'src/b.ts': 'export function b() {\n  return 1\n}\n',
        'README.md': '# demo\n',
        'package.json': '{}\n',
      },
      join(makeTempDir(), 'demo'),
    )
    const colony = colonyFor([{ name: 'p', root, kind: 'repo' }])
    await colony.refresh()
    const ids = colony.world.nodes.map((n) => n.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'world',
        'project:p',
        'project:p/demo',
        'project:p/demo/src',
        'project:p/demo/src/a.ts',
        'project:p/demo/src/b.ts#b',
        'project:p/demo/README.md',
      ]),
    )
    const repo = colony.world.nodes.find((n) => n.id === 'project:p/demo')
    expect(repo?.lines).toBe(7)
    expect(colony.world.edges).toContainEqual(
      expect.objectContaining({
        from: 'project:p/demo/src/a.ts',
        to: 'project:p/demo/src/b.ts',
        kind: 'import',
      }),
    )
    // Containers hold their children.
    const src = colony.world.nodes.find((n) => n.id === 'project:p/demo/src')
    const file = colony.world.nodes.find((n) => n.id === 'project:p/demo/src/a.ts')
    if (!src || !file) throw new Error('missing nodes')
    expect(file.rect.x).toBeGreaterThanOrEqual(src.rect.x)
    expect(file.rect.x + file.rect.w).toBeLessThanOrEqual(src.rect.x + src.rect.w)
  })

  it('keeps loose files directly in their repository or package', async () => {
    const root = makeRepo(
      {
        'package.json': '{}\n',
        'README.md': '# demo\n',
        'scripts/build.ts': 'export const build = 1\n',
        'packages/lib/package.json': '{}\n',
        'packages/lib/index.ts': 'export const lib = 1\n',
        'packages/lib/src/util.ts': 'export const util = 1\n',
      },
      join(makeTempDir(), 'demo'),
    )
    const colony = colonyFor([{ name: 'p', root, kind: 'repo' }])
    await colony.refresh()
    const byId = new Map(colony.world.nodes.map((n) => [n.id, n]))
    const parentOf = (id: string) => byId.get(id)?.parent
    const repo = 'project:p/demo'
    const lib = `${repo}/package:packages/lib`
    expect(parentOf(`${repo}/README.md`)).toBe(repo)
    expect(parentOf(`${repo}/package.json`)).toBe(repo)
    expect(parentOf(`${repo}/scripts`)).toBe(repo)
    expect(parentOf(`${repo}/scripts/build.ts`)).toBe(`${repo}/scripts`)
    expect(parentOf(lib)).toBe(repo)
    expect(parentOf(`${lib.replace('package:', '')}/index.ts`)).toBe(lib)
    expect(parentOf(`${repo}/packages/lib/src`)).toBe(lib)
    expect(byId.get(`${repo}/packages/lib/src`)?.name).toBe('src')
    expect(byId.get(repo)?.package).toBe(true)
    // No folder becomes a module of its own repository or package root.
    for (const id of [`${repo}/.`, `${repo}/package:.`, `${repo}/packages/lib`]) {
      expect(byId.has(id), id).toBe(false)
    }
    for (const n of colony.world.nodes) {
      const parent = n.parent ? byId.get(n.parent) : undefined
      if (!parent || n.kind === 'symbol') continue
      expect(n.rect.x, n.id).toBeGreaterThanOrEqual(parent.rect.x)
      expect(n.rect.y, n.id).toBeGreaterThanOrEqual(parent.rect.y)
      expect(n.rect.x + n.rect.w, n.id).toBeLessThanOrEqual(parent.rect.x + parent.rect.w)
      expect(n.rect.y + n.rect.h, n.id).toBeLessThanOrEqual(parent.rect.y + parent.rect.h)
    }
  })

  it('skips vendored and generated files', async () => {
    const root = makeRepo({
      'index.js': 'module.exports = 1\n',
      'node_modules/dep/index.js': 'module.exports = 2\n',
      'dist/out.js': 'x\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    })
    const colony = colonyFor([{ name: 'p', root, kind: 'repo' }])
    const { stats } = await colony.refresh()
    expect(stats[0]?.skipped).toBe(3)
    const files = colony.world.nodes.filter((n) => n.kind === 'file').map((n) => n.path)
    expect(files).toEqual(['index.js'])
  })

  it('indexes incrementally and keeps the layout stable as commits land', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 12; i++) files[`src/f${i}.ts`] = `export const v${i} = ${i}\n`.repeat(i + 1)
    const root = makeRepo(files)
    const cacheDir = makeTempDir()
    const colony = colonyFor([{ name: 'p', root, kind: 'repo' }], cacheDir)

    const first = await colony.refresh()
    expect(first.stats[0]).toMatchObject({ parsed: 12, reused: 0 })
    const before = rects(colony.world)
    const version = colony.world.version

    // HEAD has not moved: nothing is read and the world is unchanged.
    const again = await colony.refresh()
    expect(again).toMatchObject({ changed: false, stats: [{ unchanged: true }] })
    expect(colony.world.version).toBe(version)

    // A new commit adds one file: only its blob is parsed, and every file that
    // was already on the map keeps its place.
    commit(root, { 'src/new.ts': 'export const n = 1\n' })
    const next = await colony.refresh()
    expect(next.stats[0]).toMatchObject({ parsed: 1, reused: 12 })
    expect(colony.world.version).toBe(version + 1)
    const after = rects(colony.world)
    for (let i = 0; i < 12; i++) {
      const id = `project:p/${colony.world.nodes.find((n) => n.kind === 'repo')?.name}/src/f${i}.ts`
      expect(after.get(id), id).toBe(before.get(id))
    }

    // A fresh process reuses the on-disk fact cache and the saved layout.
    const restarted = colonyFor([{ name: 'p', root, kind: 'repo' }], cacheDir)
    const cold = await restarted.refresh()
    expect(cold.stats[0]).toMatchObject({ parsed: 0, reused: 13 })
    expect(rects(restarted.world)).toEqual(after)
  })

  it('announces a new world when HEAD moves', async () => {
    const root = makeRepo({ 'a.ts': 'export const a = 1\n' })
    const colony = await watchedColony([{ name: 'p', root, kind: 'repo' }])
    const updated = nextWorld(colony)
    commit(root, { 'b.ts': 'export const b = 2\n' })
    const world = await updated
    expect(world.nodes.some((n) => n.path === 'b.ts')).toBe(true)
  })

  it('sees a checkout that moves only HEAD', async () => {
    const root = makeRepo({ 'a.ts': 'export const a = 1\n' })
    commit(root, { 'b.ts': 'export const b = 2\n' })
    const colony = await watchedColony([{ name: 'p', root, kind: 'repo' }])
    const updated = nextWorld(colony)
    git(root, 'checkout', '-q', '--detach', 'HEAD~1')
    const world = await updated
    expect(world.nodes.some((n) => n.path === 'b.ts')).toBe(false)
  })

  it('sees a commit in a linked worktree', async () => {
    const main = makeRepo({ 'a.ts': 'export const a = 1\n' })
    const root = join(makeTempDir(), 'side')
    git(main, 'worktree', 'add', '-q', '-b', 'side', root)
    const colony = await watchedColony([{ name: 'p', root, kind: 'repo' }])
    const updated = nextWorld(colony)
    commit(root, { 'b.ts': 'export const b = 2\n' })
    const world = await updated
    expect(world.nodes.some((n) => n.path === 'b.ts')).toBe(true)
  })

  it('maps a repository that appears in a watched folder', async () => {
    const org = makeTempDir()
    makeRepo({ 'a.ts': 'export const a = 1\n' }, join(org, 'alpha'))
    const colony = await watchedColony([{ name: 'org', root: org, kind: 'repos' }])
    const updated = nextWorld(colony)
    makeRepo({ 'b.ts': 'export const b = 1\n' }, join(org, 'beta'))
    const world = await updated
    const repos = world.nodes.filter((n) => n.kind === 'repo').map((n) => n.id)
    expect(repos).toEqual(['project:org/alpha', 'project:org/beta'])
  })

  it('falls back to a full check on a timer', async () => {
    const root = makeRepo({ 'a.ts': 'export const a = 1\n' })
    const colony = colonyFor([{ name: 'p', root, kind: 'repo' }])
    await colony.refresh()
    const updated = nextWorld(colony)
    // Moved before anything watches it, so only the timer can see it.
    commit(root, { 'b.ts': 'export const b = 2\n' })
    await colony.watch({ fallbackMs: 50, settleMs: 60_000 })
    const world = await updated
    expect(world.nodes.some((n) => n.path === 'b.ts')).toBe(true)
  })

  it('maps every repository in a folder of repositories', async () => {
    const org = makeTempDir()
    makeRepo({ 'a.ts': 'export const a = 1\n' }, join(org, 'alpha'))
    makeRepo({ 'b.ts': 'export const b = 1\n' }, join(org, 'beta'))
    const colony = colonyFor([{ name: 'org', root: org, kind: 'repos' }])
    await colony.refresh()
    const repos = colony.world.nodes.filter((n) => n.kind === 'repo').map((n) => n.id)
    expect(repos).toEqual(['project:org/alpha', 'project:org/beta'])
  })

  it('links an HTTP client in one repository to the route in another', async () => {
    const org = makeTempDir()
    makeRepo(
      { 'client.ts': "export const get = () => fetch('http://api:8080/v1/users/42?x=1')\n" },
      join(org, 'web'),
    )
    makeRepo({ 'routes.ts': "app.get('/v1/users/:id', handler)\n" }, join(org, 'api'))
    const colony = colonyFor([{ name: 'org', root: org, kind: 'repos' }])
    await colony.refresh()
    expect(colony.world.edges).toContainEqual(
      expect.objectContaining({
        from: 'project:org/web/client.ts',
        to: 'project:org/api/routes.ts',
        kind: 'http',
        provenance: 'text',
        label: 'GET /v1/users/:id',
      }),
    )
  })

  it('maps a project named like the world', async () => {
    const root = makeRepo({ 'a.ts': 'export const a = 1\n' })
    const colony = colonyFor([{ name: 'world', root, kind: 'repo' }])
    await colony.refresh()
    const project = colony.world.nodes.find((n) => n.kind === 'project')
    expect(project?.id).toBe('project:world')
    expect(project?.parent).toBe('world')
    expect(colony.world.nodes.filter((n) => n.id === 'world')).toHaveLength(1)
  })

  it('draws no HTTP edge from a client whose path has no literal segment', async () => {
    const org = makeTempDir()
    makeRepo(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a URL template as written in source
      { 'client.ts': 'export const get = (base: string, p: string) => fetch(`${base}/${p}`)\n' },
      join(org, 'web'),
    )
    makeRepo({ 'routes.ts': "app.get('/health', handler)\n" }, join(org, 'api'))
    const colony = colonyFor([{ name: 'org', root: org, kind: 'repos' }])
    await colony.refresh()
    expect(colony.world.edges.filter((e) => e.kind === 'http')).toEqual([])
  })

  it('reads HTTP client instances named api or server as clients, not routes', async () => {
    const org = makeTempDir()
    makeRepo(
      {
        'client.ts':
          "const api = axios.create()\nconst server = ky.create()\nexport const list = () => api.get('/users')\nexport const ping = () => server.get('/ping')\n",
      },
      join(org, 'web'),
    )
    makeRepo({ 'other.ts': "export const users = () => fetch('/users')\n" }, join(org, 'svc'))
    const colony = colonyFor([{ name: 'org', root: org, kind: 'repos' }])
    await colony.refresh()
    const client = colony.world.nodes.find((n) => n.id === 'project:org/web/client.ts')
    expect(client?.transports?.filter((t) => t.kind === 'http-route') ?? []).toEqual([])
    expect(colony.world.edges.filter((e) => e.kind === 'http')).toEqual([])
  })
})
