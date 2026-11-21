import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Synthetic git repositories for tests. Never point tests at real projects.

export function tempDir(prefix = 'codecolony-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { encoding: 'utf8' },
  ).trim()
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

// Writes the files and commits them; returns the new commit.
export function commit(repo: string, files: Record<string, string>, message = 'change'): string {
  writeFiles(repo, files)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', message)
  return git(repo, 'rev-parse', 'HEAD')
}

export function makeRepo(files: Record<string, string>, dir = tempDir()): string {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  if (Object.keys(files).length > 0) commit(dir, files, 'initial')
  return dir
}
