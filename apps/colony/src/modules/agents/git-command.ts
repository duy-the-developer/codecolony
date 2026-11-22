import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Runs read-only git commands in other people's checkouts. Optional locks
// are off, so `git status` never rewrites the index of a copy someone is
// working in.

const run = promisify(execFile)
const TIMEOUT_MS = 15_000
const MAX_BUFFER = 64 * 1024 * 1024

export async function runGit(dir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run('git', ['--no-optional-locks', '-C', dir, ...args], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout
}

// The command's output, or undefined when git fails (not a repository, no
// such ref).
export async function tryGit(dir: string, args: readonly string[]): Promise<string | undefined> {
  try {
    return await runGit(dir, args)
  } catch {
    return undefined
  }
}

// Runs `task` on every item, at most `lanes` at a time.
export async function forEachLimited<T>(
  items: readonly T[],
  lanes: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(lanes, items.length) }, async () => {
    while (next < items.length) await task(items[next++] as T)
  })
  await Promise.all(workers)
}
