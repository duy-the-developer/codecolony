import { existsSync, type FSWatcher, watch } from 'node:fs'
import { join } from 'node:path'
import { logError } from '../logging/log.ts'
import { forEachLimited, HEAD_LANES, readGitDirs } from './git.ts'

// Watches the files git rewrites when a repository's HEAD moves, so the colony
// checks only the repositories that changed instead of polling every one:
// HEAD in the checkout's git dir (a linked worktree has its own), and the
// branches, packed-refs and reftable in the common dir all worktrees share.
// A folder of repositories is watched for repositories that come and go.
// Watching is best effort; the colony keeps a slow poll for anything missed.

export interface HeadWatcherOptions {
  onRepoChange: (repo: string) => void
  onFolderChange: () => void
}

export interface HeadWatcherHandle {
  // Watches exactly these repositories and folders from now on.
  sync(repos: readonly string[], folders: readonly string[]): Promise<void>
  close(): void
}

export function createHeadWatcher({
  onRepoChange,
  onFolderChange,
}: HeadWatcherOptions): HeadWatcherHandle {
  const repos = new Map<string, FSWatcher[]>()
  const folders = new Map<string, FSWatcher[]>()
  let closed = false

  async function armRepo(repo: string, slot: FSWatcher[]): Promise<void> {
    if (closed || repos.get(repo) !== slot) return
    const dirs = await readGitDirs(repo)
    if (!dirs) return
    const watchers = watchGitDirs(dirs.gitDir, dirs.commonDir, () => onRepoChange(repo))
    if (closed || repos.get(repo) !== slot) {
      closeAll(watchers)
      return
    }
    slot.push(...watchers)
    // HEAD may have moved before the watchers were in place.
    onRepoChange(repo)
  }

  return {
    async sync(nextRepos, nextFolders) {
      if (closed) return
      dropMissing(repos, nextRepos)
      dropMissing(folders, nextFolders)
      for (const folder of nextFolders) {
        if (folders.has(folder)) continue
        const watcher = watchPath(folder, false, onFolderChange)
        folders.set(folder, watcher ? [watcher] : [])
      }
      // Reserve every slot first: a sync that drops a repository meanwhile
      // replaces its slot, and the watchers made for it are closed.
      const added = nextRepos
        .filter((repo) => !repos.has(repo))
        .map((repo): [string, FSWatcher[]] => [repo, []])
      for (const [repo, slot] of added) repos.set(repo, slot)
      await forEachLimited(added, HEAD_LANES, ([repo, slot]) => armRepo(repo, slot))
    },
    close() {
      closed = true
      for (const watchers of [...repos.values(), ...folders.values()]) closeAll(watchers)
      repos.clear()
      folders.clear()
    },
  }
}

function watchGitDirs(gitDir: string, commonDir: string, onChange: () => void): FSWatcher[] {
  const isRefFile = (name: string | null) => name === null || !name.endsWith('.lock')
  const watchers = [
    watchPath(gitDir, false, (name) => {
      if (name === null || name === 'HEAD' || name === 'packed-refs') onChange()
    }),
    watchPath(join(commonDir, 'refs', 'heads'), true, (name) => {
      if (isRefFile(name)) onChange()
    }),
  ]
  if (commonDir !== gitDir) {
    watchers.push(
      watchPath(commonDir, false, (name) => {
        if (name === null || name === 'packed-refs') onChange()
      }),
    )
  }
  const reftable = join(commonDir, 'reftable')
  if (existsSync(reftable)) {
    watchers.push(
      watchPath(reftable, false, (name) => {
        if (isRefFile(name)) onChange()
      }),
    )
  }
  return watchers.filter((watcher) => watcher !== undefined)
}

function watchPath(
  path: string,
  recursive: boolean,
  onEvent: (name: string | null) => void,
): FSWatcher | undefined {
  try {
    const watcher = watch(path, { recursive, persistent: false }, (_event, name) => onEvent(name))
    watcher.on('error', (error) => {
      logError('Git watch failed', { path, error })
      watcher.close()
    })
    return watcher
  } catch (error) {
    logError('Git watch failed', { path, error })
    return undefined
  }
}

function dropMissing(watched: Map<string, FSWatcher[]>, keep: readonly string[]): void {
  const wanted = new Set(keep)
  for (const [path, watchers] of watched) {
    if (wanted.has(path)) continue
    closeAll(watchers)
    watched.delete(path)
  }
}

function closeAll(watchers: readonly FSWatcher[]): void {
  for (const watcher of watchers) watcher.close()
}
