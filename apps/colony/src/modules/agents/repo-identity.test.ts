import { describe, expect, it } from 'vitest'
import { identitiesMatch, normalizeRemote } from './repo-identity.ts'

describe('normalizeRemote', () => {
  it.each([
    ['git@github.com:Owner/Repo.git', 'github.com/owner/repo'],
    ['https://github.com/owner/repo', 'github.com/owner/repo'],
    ['https://user:secret@github.com/owner/repo.git/', 'github.com/owner/repo'],
    ['ssh://git@github.com:22/owner/repo.git', 'github.com/owner/repo'],
    ['file:///srv/git/repo.git', '/srv/git/repo'],
    ['/srv/git/repo', '/srv/git/repo'],
  ])('reads %s as %s', (url, expected) => {
    expect(normalizeRemote(url)).toBe(expected)
  })
})

describe('identitiesMatch', () => {
  it('matches clones by origin, and by root commit when one has no origin', () => {
    const mine = { toplevel: '/a', origin: 'github.com/o/r', rootCommit: 'c1' }
    expect(identitiesMatch(mine, { toplevel: '/b', origin: 'github.com/o/r' })).toBe(true)
    expect(
      identitiesMatch(mine, { toplevel: '/b', origin: 'github.com/o/x', rootCommit: 'c1' }),
    ).toBe(false)
    expect(identitiesMatch(mine, { toplevel: '/b', rootCommit: 'c1' })).toBe(true)
    expect(identitiesMatch({ toplevel: '/a' }, { toplevel: '/b' })).toBe(false)
  })
})
