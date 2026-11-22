import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { logError } from '../logging/log.ts'
import type { Colonist, ColonistsResponse } from '../wire/api-types.ts'
import { copyLabel, resolvePresence, tildify } from './colonist-status.ts'
import {
  type BaseRef,
  type CopyDiff,
  readCopyDiff,
  readCopySignature,
  resolveBaseRef,
} from './copy-diff.ts'
import { type FirstmateTask, listFirstmateClones, readFirstmateTasks } from './firstmate-tasks.ts'
import { forEachLimited } from './git-command.ts'
import { identitiesMatch, type RepoIdentity, readRepoIdentity } from './repo-identity.ts'
import { isInside, type LiveSession, type SessionSource } from './session-source.ts'
import { listWorktrees } from './worktree-list.ts'

// Finds the colonists of the mapped repositories and keeps them current.
//
// Git first: every clone of a mapped repository (the repository itself,
// firstmate's clones, the clone any live session or firstmate task works in)
// is matched by repository identity, and each of its worktrees is a copy.
// A copy whose files differ from its main branch is a colonist. Session
// sources and the firstmate home only add who is at work and how it goes.
//
// A light poll reads each copy's `git status` and diffs only the copies whose
// status changed; clones and worktrees are found again on a slower beat, or
// at once when asked (the map's repositories moved).

export interface MappedRepo {
  // The repository's node id on the map.
  id: string
  root: string
}

export interface ColonistTrackerOptions {
  listRepos(): readonly MappedRepo[]
  sessions?: readonly SessionSource[]
  firstmateHome?: string
  // Shortens copy paths to `~/...`.
  home?: string
}

export interface WatchColonistsOptions {
  pollMs?: number
  discoverMs?: number
}

export interface ColonistTrackerHandle {
  readonly snapshot: ColonistsResponse
  // Reads every source and copy now; with discover, finds clones and
  // worktrees afresh first.
  refresh(options?: { discover?: boolean }): Promise<void>
  // Polls until closed.
  watch(options?: WatchColonistsOptions): void
  // Called with each new snapshot; returns the unsubscribe.
  onChange(listener: (snapshot: ColonistsResponse) => void): () => void
  close(): void
}

const POLL_MS = 4000
const DISCOVER_MS = 30_000
const GIT_LANES = 4

interface CopyState {
  path: string
  repoId: string
  clone: string
  head: string
  branch?: string
  signature?: string
  diff?: CopyDiff
  base?: BaseRef
}

export function createColonistTracker(options: ColonistTrackerOptions): ColonistTrackerHandle {
  const sources = options.sessions ?? []
  const home = options.home ?? homedir()
  let snapshot: ColonistsResponse = { version: 0, colonists: [] }
  const listeners = new Set<(snapshot: ColonistsResponse) => void>()
  // Every folder asked about, and the repository it turned out to be in.
  const identities = new Map<string, RepoIdentity | null>()
  const bases = new Map<string, BaseRef | undefined>()
  let copies = new Map<string, CopyState>()
  let discoveredAt = Number.NEGATIVE_INFINITY
  let discoverMs = DISCOVER_MS
  let running: Promise<void> | undefined
  let pending: { discover: boolean } | undefined
  let timer: NodeJS.Timeout | undefined
  let closed = false

  async function identityOf(dir: string): Promise<RepoIdentity | null> {
    const known = identities.get(dir)
    if (known !== undefined) return known
    const identity = (await readRepoIdentity(dir)) ?? null
    identities.set(dir, identity)
    return identity
  }

  // Clones of mapped repositories among the candidates, and their worktrees.
  async function discover(candidates: readonly string[]): Promise<void> {
    identities.clear()
    bases.clear()
    const repos = options.listRepos()
    const mapped: { repo: MappedRepo; identity: RepoIdentity }[] = []
    for (const repo of repos) {
      const identity = await identityOf(repo.root)
      if (identity) mapped.push({ repo, identity })
    }
    const clones = new Map<string, MappedRepo>()
    for (const dir of [...repos.map((repo) => repo.root), ...candidates]) {
      const identity = await identityOf(dir)
      if (!identity || clones.has(identity.toplevel)) continue
      const match = mapped.find((m) => identitiesMatch(m.identity, identity))
      if (match) clones.set(identity.toplevel, match.repo)
    }
    const next = new Map<string, CopyState>()
    await forEachLimited([...clones], GIT_LANES, async ([clone, repo]) => {
      for (const worktree of await listWorktrees(clone)) {
        const path = realPath(worktree.path)
        if (next.has(path)) continue
        const before = copies.get(path)
        const state: CopyState = { path, repoId: repo.id, clone, head: worktree.head }
        if (worktree.branch) state.branch = worktree.branch
        if (before?.repoId === repo.id) {
          if (before.signature !== undefined) state.signature = before.signature
          if (before.diff) state.diff = before.diff
          if (before.base) state.base = before.base
        }
        next.set(path, state)
      }
    })
    copies = next
    discoveredAt = Date.now()
  }

  async function baseOf(clone: string): Promise<BaseRef | undefined> {
    if (!bases.has(clone)) bases.set(clone, await resolveBaseRef(clone))
    return bases.get(clone)
  }

  // Diffs the copies whose status changed, or all of them.
  async function scan(force: boolean): Promise<void> {
    await forEachLimited([...copies.values()], GIT_LANES, async (copy) => {
      const signature = await readCopySignature(copy.path)
      if (signature === undefined) return
      if (!force && signature === copy.signature && copy.diff) return
      const base = await baseOf(copy.clone)
      try {
        copy.diff = await readCopyDiff(copy.path, base)
        copy.signature = signature
        if (base) copy.base = base
        else delete copy.base
        const branch = /# branch\.head ([^\0]+)/.exec(signature)?.[1]
        const head = /# branch\.oid ([0-9a-f]+)/.exec(signature)?.[1]
        if (branch && branch !== '(detached)') copy.branch = branch
        else delete copy.branch
        if (head) copy.head = head
      } catch (error) {
        logError('Could not diff a copy', { copy: copy.path, error })
      }
    })
  }

  async function run(discoverNow: boolean): Promise<void> {
    const { firstmateHome } = options
    const [tasks, sessionLists, clones] = await Promise.all([
      firstmateHome ? readFirstmateTasks(firstmateHome) : Promise.resolve<FirstmateTask[]>([]),
      Promise.all(
        sources.map((source) =>
          source.listSessions().catch((error: unknown) => {
            logError('Session source failed', { source: source.name, error })
            return undefined
          }),
        ),
      ),
      firstmateHome ? listFirstmateClones(firstmateHome) : Promise.resolve<string[]>([]),
    ])
    const canSeeSessions = sessionLists.some((list) => list !== undefined)
    const sessions = sessionLists
      .flatMap((list) => list ?? [])
      .map((session) => ({ ...session, cwd: realPath(session.cwd) }))
    const worktrees = tasks.flatMap((task) => (task.worktree ? [realPath(task.worktree)] : []))
    const candidates = [...clones, ...worktrees, ...sessions.map((session) => session.cwd)]
    const isNew = (dir: string) =>
      !identities.has(dir) && ![...copies.keys()].some((copy) => isInside(dir, copy))
    const shouldDiscover =
      discoverNow || Date.now() - discoveredAt >= discoverMs || candidates.some(isNew)
    if (shouldDiscover) await discover(candidates)
    await scan(shouldDiscover)
    publish(buildColonists(tasks, sessions, canSeeSessions))
  }

  function buildColonists(
    tasks: readonly FirstmateTask[],
    sessions: readonly LiveSession[],
    canSeeSessions: boolean,
  ): Colonist[] {
    const paths = [...copies.keys()]
    // A session belongs to the deepest copy around its folder.
    const ownerOf = (cwd: string) =>
      paths
        .filter((path) => isInside(cwd, path))
        .sort((a, b) => b.length - a.length)
        .at(0)
    const colonists: Colonist[] = []
    for (const copy of [...copies.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const diff = copy.diff
      if (!diff || diff.changes.length + diff.omitted === 0) continue
      const task = tasks.find((t) => t.worktree && realPath(t.worktree) === copy.path)
      const here = sessions.filter((session) => ownerOf(session.cwd) === copy.path)
      const presence = resolvePresence(task, here, canSeeSessions)
      const colonist: Colonist = {
        id: copy.path,
        repoId: copy.repoId,
        label: task?.id ?? copyLabel(copy.path, copy.branch),
        status: presence.status,
        session: presence.session,
        copy: tildify(copy.path, home),
        head: copy.head.slice(0, 7),
        base: copy.base?.name ?? 'HEAD',
        changes: diff.changes,
        omitted: diff.omitted,
      }
      if (presence.note) colonist.note = presence.note
      if (task) colonist.task = task.id
      if (presence.agent) colonist.agent = presence.agent
      if (copy.branch) colonist.branch = copy.branch
      if (presence.pr) colonist.pr = presence.pr
      if (presence.paneId) colonist.paneId = presence.paneId
      colonists.push(colonist)
    }
    return colonists
  }

  function publish(colonists: Colonist[]): void {
    if (JSON.stringify(colonists) === JSON.stringify(snapshot.colonists)) return
    snapshot = { version: snapshot.version + 1, colonists }
    for (const listener of listeners) listener(snapshot)
  }

  // One refresh at a time; requests made meanwhile merge into the next.
  function refresh({ discover: discoverNow = false } = {}): Promise<void> {
    if (running) {
      pending = { discover: discoverNow || (pending?.discover ?? false) }
      return running
    }
    running = run(discoverNow)
      .catch((error: unknown) => logError('Colonist refresh failed', { error }))
      .finally(() => {
        running = undefined
        const next = pending
        pending = undefined
        if (next && !closed) void refresh(next)
      })
    return running
  }

  return {
    get snapshot() {
      return snapshot
    },
    refresh,
    watch({ pollMs = POLL_MS, discoverMs: every = DISCOVER_MS } = {}) {
      discoverMs = every
      clearInterval(timer)
      timer = setInterval(() => void refresh(), pollMs)
      timer.unref()
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      clearInterval(timer)
      listeners.clear()
    },
  }
}

// The path with symlinks resolved, so the same folder compares equal however
// git, lsof or a firstmate record spells it.
function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
