import { basename } from 'node:path'
import { findAdapter } from '../adapters/registry.ts'
import type { FileFacts } from '../core/model.ts'
import { type FactCache, factKey } from './cache.ts'
import { listTree, readBlobs, type TreeEntry } from './git.ts'
import { parseFacts } from './parse-facts.ts'

// Indexes one repository at its HEAD commit, incrementally: an unchanged HEAD
// is skipped, and only blobs missing from the fact cache are read and parsed.

export interface IndexedFile {
  path: string
  sha: string
  facts: FileFacts
  // Size-only stand-in for a parse that failed for a reason outside the blob
  // (a parse worker died): kept on the map, never cached or reused.
  provisional?: boolean
}

export interface RepoIndex {
  name: string
  root: string
  commit: string | undefined
  files: IndexedFile[]
}

export interface IndexStats {
  // Blobs read from git and parsed in this run.
  parsed: number
  // Files whose facts came from the cache or the previous index.
  reused: number
  // Files left out as vendored, generated or too large.
  skipped: number
  // True when HEAD had not moved and the previous index was returned.
  unchanged: boolean
}

const VENDORED = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  '__pycache__',
])
const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
])
const MAX_BYTES = 1024 * 1024

export function isVendored(entry: TreeEntry): boolean {
  if (entry.size > MAX_BYTES) return true
  const name = basename(entry.path)
  if (LOCKFILES.has(name) || /\.min\.(js|css)$/.test(name) || name.endsWith('.map')) return true
  return entry.path.split('/').some((segment) => VENDORED.has(segment))
}

// Turns a blob into facts: parseFacts itself, or a parse pool running it.
export type ParseBlob = (
  path: string,
  bytes: Uint8Array,
) => Promise<{ facts: FileFacts; provisional: boolean }>

const parseOnMainThread: ParseBlob = async (path, bytes) => ({
  facts: await parseFacts(path, bytes),
  provisional: false,
})

// `commit` is the repository's HEAD, read by the caller (`readHeadCommits`).
export async function indexRepo(
  root: string,
  commit: string | undefined,
  cache: FactCache,
  previous?: RepoIndex,
  parse: ParseBlob = parseOnMainThread,
): Promise<{ index: RepoIndex; stats: IndexStats }> {
  const name = basename(root)
  const stats: IndexStats = { parsed: 0, reused: 0, skipped: 0, unchanged: false }
  if (previous && previous.commit === commit) {
    return { index: previous, stats: { ...stats, unchanged: true } }
  }
  if (!commit) return { index: { name, root, commit, files: [] }, stats }

  const known = new Map(previous?.files.map((file) => [file.path, file]))
  const files: IndexedFile[] = []
  const missing: TreeEntry[] = []
  for (const entry of await listTree(root, commit)) {
    if (isVendored(entry)) {
      stats.skipped++
      continue
    }
    const before = known.get(entry.path)
    const facts =
      before?.sha === entry.sha && !before.provisional ? before.facts : cache.get(keyOf(entry))
    if (facts) {
      stats.reused++
      files.push({ path: entry.path, sha: entry.sha, facts })
    } else {
      missing.push(entry)
    }
  }

  const blobs = await readBlobs(
    root,
    missing.map((entry) => entry.sha),
  )
  // Every missing blob is handed to the parser at once, so a pool keeps all
  // its workers busy; each result is cached as soon as it arrives.
  await Promise.all(
    missing.map(async (entry) => {
      const bytes = blobs.get(entry.sha)
      if (!bytes) return
      const { facts, provisional } = await parse(entry.path, bytes)
      if (!provisional) cache.set(keyOf(entry), facts)
      stats.parsed++
      files.push({ path: entry.path, sha: entry.sha, facts, provisional })
    }),
  )
  files.sort((a, b) => (a.path < b.path ? -1 : 1))
  return { index: { name, root, commit, files }, stats }
}

function keyOf(entry: TreeEntry): string {
  return factKey(entry.sha, findAdapter(entry.path)?.id ?? 'text')
}
