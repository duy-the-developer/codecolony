import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { fileUnits } from '../layout/pack-cells.ts'
import type { ChangeKind, ColonistChange } from '../wire/api-types.ts'
import { runGit, tryGit } from './git-command.ts'

// What a copy changed since it forked from its main branch: committed and
// uncommitted changes plus untracked files. The diff is taken from the merge
// base, never from the branch tip, so a copy parked on an old commit does not
// show everything the main branch did since as its own changes.

// Changes kept per copy; a copy past it is a branch, not a session's work.
export const MAX_CHANGES = 1000
// Bytes read from an added file to count its lines.
const MAX_COUNT_BYTES = 1024 * 1024
const BASE_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master'] as const

export interface BaseRef {
  // What git resolves, such as `origin/production`.
  ref: string
  // What people call it, such as `production`.
  name: string
}

export interface CopyDiff {
  changes: ColonistChange[]
  omitted: number
}

// The main branch of a clone: origin's default branch, else main or master.
export async function resolveBaseRef(clone: string): Promise<BaseRef | undefined> {
  const remoteHead = (
    await tryGit(clone, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  )?.trim()
  for (const ref of [remoteHead, ...BASE_CANDIDATES]) {
    if (!ref) continue
    const commit = await tryGit(clone, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (commit?.trim()) return { ref, name: ref.replace(/^origin\//, '') }
  }
  return undefined
}

// Changes whenever the copy's HEAD, index or working tree files change.
export async function readCopySignature(copy: string): Promise<string | undefined> {
  return tryGit(copy, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
}

export async function readCopyDiff(copy: string, base: BaseRef | undefined): Promise<CopyDiff> {
  const forkPoint = base
    ? (await tryGit(copy, ['merge-base', 'HEAD', base.ref]))?.trim() || 'HEAD'
    : 'HEAD'
  const [diff, untracked] = await Promise.all([
    runGit(copy, ['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', forkPoint]),
    runGit(copy, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const kinds = new Map<string, ChangeKind>()
  const fields = diff.split('\0')
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] as string
    const path = fields[i + 1] as string
    if (!status || !path) continue
    kinds.set(path, status[0] === 'A' ? 'added' : status[0] === 'D' ? 'removed' : 'modified')
  }
  for (const path of untracked.split('\0')) if (path) kinds.set(path, 'added')

  const paths = [...kinds.keys()].sort()
  const kept = paths.slice(0, MAX_CHANGES)
  const changes = await Promise.all(
    kept.map(async (path): Promise<ColonistChange> => {
      const kind = kinds.get(path) as ChangeKind
      const units = kind === 'added' ? fileUnits(await countLines(join(copy, path))) : 1
      return { path, kind, units }
    }),
  )
  return { changes, omitted: paths.length - kept.length }
}

// Lines in the first megabyte of a file; 0 when it cannot be read.
async function countLines(path: string): Promise<number> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(MAX_COUNT_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, MAX_COUNT_BYTES, 0)
    if (bytesRead === 0) return 0
    let lines = 1
    for (let i = 0; i < bytesRead; i++) if (buffer[i] === 10) lines++
    return buffer[bytesRead - 1] === 10 ? lines - 1 : lines
  } catch {
    return 0
  } finally {
    await handle?.close()
  }
}
