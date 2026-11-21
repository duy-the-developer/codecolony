import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

// Reads committed trees straight from git, so indexing never depends on the
// working tree and never writes into the repository.

const run = promisify(execFile)
const MAX_BUFFER = 256 * 1024 * 1024
// Concurrent `git rev-parse` processes when checking many repositories.
const HEAD_LANES = Math.min(8, availableParallelism())

export interface TreeEntry {
  path: string
  sha: string
  size: number
}

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

export async function readHeadCommit(repo: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', 'HEAD'])
    return stdout.trim() || undefined
  } catch {
    // An empty repository has no HEAD yet.
    return undefined
  }
}

// HEAD of many repositories, a few git processes at a time.
export async function readHeadCommits(
  repos: readonly string[],
): Promise<Map<string, string | undefined>> {
  const heads = new Map<string, string | undefined>()
  let next = 0
  const lanes = Array.from({ length: Math.min(HEAD_LANES, repos.length) }, async () => {
    for (let repo = repos[next++]; repo !== undefined; repo = repos[next++]) {
      heads.set(repo, await readHeadCommit(repo))
    }
  })
  await Promise.all(lanes)
  return heads
}

export interface GitDirs {
  // Holds this checkout's HEAD: `.git`, or `.git/worktrees/<name>` for a
  // linked worktree.
  gitDir: string
  // Holds the refs every worktree shares.
  commonDir: string
}

export async function readGitDirs(repo: string): Promise<GitDirs | undefined> {
  try {
    const { stdout } = await run('git', [
      '-C',
      repo,
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
      '--git-common-dir',
    ])
    const [gitDir, commonDir] = stdout.trim().split('\n')
    return gitDir && commonDir ? { gitDir, commonDir } : undefined
  } catch {
    return undefined
  }
}

// Regular files of a commit; submodules and symlinks are left out.
export async function listTree(repo: string, commit: string): Promise<TreeEntry[]> {
  const { stdout } = await run('git', ['-C', repo, 'ls-tree', '-r', '-z', '--long', commit], {
    maxBuffer: MAX_BUFFER,
  })
  const entries: TreeEntry[] = []
  for (const record of stdout.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    const [mode, type, sha, size] = record.slice(0, tab).split(/\s+/)
    if (type !== 'blob' || mode === '120000' || !sha) continue
    entries.push({ path: record.slice(tab + 1), sha, size: Number(size) })
  }
  return entries
}

// Reads many blobs through one `git cat-file --batch` process.
export function readBlobs(repo: string, shas: readonly string[]): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const blobs = new Map<string, Buffer>()
    if (shas.length === 0) {
      resolve(blobs)
      return
    }
    const child = spawn('git', ['-C', repo, 'cat-file', '--batch'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let buffer = Buffer.alloc(0)
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const newline = buffer.indexOf(10)
        if (newline === -1) return
        const [sha, type, size] = buffer.subarray(0, newline).toString().split(' ')
        if (type === 'missing' || !sha) {
          buffer = buffer.subarray(newline + 1)
          continue
        }
        const length = Number(size)
        const end = newline + 1 + length
        if (buffer.length < end + 1) return
        blobs.set(sha, buffer.subarray(newline + 1, end))
        buffer = buffer.subarray(end + 1)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(blobs)
      else reject(new Error(`git cat-file failed (${code}): ${stderr.trim()}`))
    })
    child.stdin.end(`${shas.join('\n')}\n`)
  })
}
