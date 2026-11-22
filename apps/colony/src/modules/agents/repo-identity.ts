import { tryGit } from './git-command.ts'

// Which repository a checkout is a copy of. Clones of one repository share
// their origin; firstmate's clone and the worktrees hanging off it count as
// copies of your own clone of the same repository. Without an origin, the
// first root commit stands in.

export interface RepoIdentity {
  // The checkout's top folder.
  toplevel: string
  // The origin URL as host/owner/name, lower case, without scheme or `.git`.
  origin?: string
  rootCommit?: string
}

export async function readRepoIdentity(dir: string): Promise<RepoIdentity | undefined> {
  const toplevel = (await tryGit(dir, ['rev-parse', '--show-toplevel']))?.trim()
  if (!toplevel) return undefined
  const [url, roots] = await Promise.all([
    tryGit(toplevel, ['config', '--get', 'remote.origin.url']),
    tryGit(toplevel, ['rev-list', '--max-parents=0', 'HEAD']),
  ])
  const identity: RepoIdentity = { toplevel }
  const origin = url ? normalizeRemote(url.trim()) : ''
  if (origin) identity.origin = origin
  const rootCommit = roots?.trim().split('\n').sort()[0]
  if (rootCommit) identity.rootCommit = rootCommit
  return identity
}

// Same origin when both have one; otherwise the same root commit.
export function identitiesMatch(a: RepoIdentity, b: RepoIdentity): boolean {
  if (a.toplevel === b.toplevel) return true
  if (a.origin && b.origin) return a.origin === b.origin
  return a.rootCommit !== undefined && a.rootCommit === b.rootCommit
}

// git@github.com:Owner/Repo.git, https://user@github.com/owner/repo and
// ssh://git@github.com/owner/repo.git all become github.com/owner/repo.
// A local path stays a path.
export function normalizeRemote(url: string): string {
  let rest = url.replace(/\/+$/, '').replace(/\.git$/, '')
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(rest)
  if (scheme) {
    rest = rest.slice(scheme[0].length)
    if (scheme[0].toLowerCase() === 'file://') return rest
  } else {
    const scp = /^([^/@:]+@)?([^/:]+):(?!\/)(.*)$/.exec(rest)
    if (!scp) return rest
    rest = `${scp[2]}/${scp[3]}`
  }
  rest = rest.replace(/^[^/@]+@/, '').replace(/:\d+\//, '/')
  return rest.toLowerCase()
}
