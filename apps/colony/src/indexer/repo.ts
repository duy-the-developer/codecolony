import { basename } from 'node:path'
import { findAdapter, TRANSPORT_DETECTORS } from '../adapters/registry.ts'
import type { FileFacts } from '../core/model.ts'
import { parseFile, textFacts } from '../core/parse.ts'
import { type FactCache, factKey } from './cache.ts'
import { listTree, readBlobs, readHeadCommit, type TreeEntry } from './git.ts'

// Indexes one repository at its HEAD commit, incrementally: an unchanged HEAD
// is skipped, and only blobs missing from the fact cache are read and parsed.

export interface IndexedFile {
  path: string
  sha: string
  facts: FileFacts
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

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0)
}

export async function indexRepo(
  root: string,
  cache: FactCache,
  previous?: RepoIndex,
): Promise<{ index: RepoIndex; stats: IndexStats }> {
  const name = basename(root)
  const commit = await readHeadCommit(root)
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
    const facts = before?.sha === entry.sha ? before.facts : cache.get(keyOf(entry))
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
  for (const entry of missing) {
    const bytes = blobs.get(entry.sha)
    if (!bytes) continue
    const facts = await factsFor(entry.path, bytes)
    cache.set(keyOf(entry), facts)
    stats.parsed++
    files.push({ path: entry.path, sha: entry.sha, facts })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1))
  return { index: { name, root, commit, files }, stats }
}

function keyOf(entry: TreeEntry): string {
  return factKey(entry.sha, findAdapter(entry.path)?.id ?? 'text')
}

async function factsFor(path: string, bytes: Buffer): Promise<FileFacts> {
  if (isBinary(bytes)) return { ...textFacts(''), language: 'binary' }
  const source = bytes.toString('utf8')
  const adapter = findAdapter(path)
  if (!adapter) return textFacts(source)
  try {
    return await parseFile(adapter, TRANSPORT_DETECTORS, path, source)
  } catch {
    // A grammar that cannot read the file still leaves its size on the map.
    return textFacts(source)
  }
}
