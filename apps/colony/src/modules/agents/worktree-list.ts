import { existsSync } from 'node:fs'
import { tryGit } from './git-command.ts'

// The checkouts of one clone: its own working tree and its linked worktrees,
// as `git worktree list --porcelain` reports them. Bare, missing and
// prunable entries are left out.

export interface Worktree {
  path: string
  head: string
  // Short branch name; undefined when detached.
  branch?: string
}

export async function listWorktrees(clone: string): Promise<Worktree[]> {
  const output = await tryGit(clone, ['worktree', 'list', '--porcelain', '-z'])
  if (output === undefined) return []
  return parseWorktreeList(output).filter((worktree) => existsSync(worktree.path))
}

export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = []
  // A record is NUL-separated `key value` fields ending with an empty field.
  let fields = new Map<string, string>()
  const flush = () => {
    const path = fields.get('worktree')
    const head = fields.get('HEAD')
    if (path && head && !fields.has('bare') && !fields.has('prunable')) {
      const worktree: Worktree = { path, head }
      const branch = fields.get('branch')
      if (branch) worktree.branch = branch.replace(/^refs\/heads\//, '')
      worktrees.push(worktree)
    }
    fields = new Map()
  }
  for (const field of output.split('\0')) {
    if (field === '') {
      flush()
      continue
    }
    const space = field.indexOf(' ')
    if (space < 0) fields.set(field, '')
    else fields.set(field.slice(0, space), field.slice(space + 1))
  }
  flush()
  return worktrees
}
