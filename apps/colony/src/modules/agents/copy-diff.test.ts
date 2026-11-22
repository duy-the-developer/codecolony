import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commit, git, makeRepo, makeTempDir } from '../indexing/testing/git-fixture.ts'
import { readCopyDiff, readCopySignature, resolveBaseRef } from './copy-diff.ts'

describe('readCopyDiff', () => {
  it('lists committed, uncommitted and untracked changes since the fork point', async () => {
    const repo = makeRepo({ 'a.ts': 'a\n', 'b.ts': 'b\n', 'c.ts': 'c\n' })
    git(repo, 'checkout', '-q', '-b', 'feature')
    commit(repo, { 'b.ts': 'b2\n' })
    git(repo, 'checkout', '-q', 'main')
    commit(repo, { 'd.ts': 'main moved on\n' })
    git(repo, 'checkout', '-q', 'feature')
    writeFileSync(join(repo, 'a.ts'), 'a2\n')
    rmSync(join(repo, 'c.ts'))
    writeFileSync(join(repo, 'new.ts'), `${'line\n'.repeat(40)}`)

    const base = await resolveBaseRef(repo)
    expect(base).toEqual({ ref: 'main', name: 'main' })
    expect(await readCopyDiff(repo, base)).toEqual({
      changes: [
        { path: 'a.ts', kind: 'modified', units: 1 },
        { path: 'b.ts', kind: 'modified', units: 1 },
        { path: 'c.ts', kind: 'removed', units: 1 },
        { path: 'new.ts', kind: 'added', units: 2 },
      ],
      omitted: 0,
    })
  })

  it('takes the main branch from origin in a clone', async () => {
    const origin = makeRepo({ 'a.ts': 'a\n' })
    const clone = join(makeTempDir(), 'clone')
    git(origin, 'clone', '-q', origin, clone)
    expect(await resolveBaseRef(clone)).toEqual({ ref: 'origin/main', name: 'main' })
  })

  it('never writes the index of the copy it reads', async () => {
    const repo = makeRepo({ 'a.ts': 'a\n' })
    writeFileSync(join(repo, 'a.ts'), 'a2\n')
    const before = git(repo, 'ls-files', '--debug')
    const signature = await readCopySignature(repo)
    expect(signature).toContain('a.ts')
    expect(git(repo, 'ls-files', '--debug')).toBe(before)
  })
})
