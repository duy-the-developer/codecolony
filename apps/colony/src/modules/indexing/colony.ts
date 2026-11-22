import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ColonyConfig, ProjectConfig } from '../config/load-config.ts'
import { findAdapter, LANGUAGE_ADAPTERS, RULES_VERSION } from '../language/registry.ts'
import { emptyLayout, layoutWorld } from '../layout/world-layout.ts'
import { logError } from '../logging/log.ts'
import type { FileResponse } from '../wire/api-types.ts'
import { type Edge, qualifiedName } from '../world/facts.ts'
import type { World } from '../world/world-types.ts'
import { buildWorld, type ProjectIndex, repoId } from './build-world.ts'
import { FactCache } from './fact-cache.ts'
import { isGitRepo, readBlobs, readHeadCommits } from './git.ts'
import { createHeadWatcher, type HeadWatcherHandle } from './head-watcher.ts'
import { loadLayout, saveLayout } from './layout-store.ts'
import { LspPool } from './lsp-pool.ts'
import { buildTextFacts } from './parse-facts.ts'
import { createParsePool, ParsePoolError } from './parse-pool.ts'
import { type IndexStats, indexRepo, type ParseBlob, type RepoIndex } from './repo.ts'

// Keeps the world for a config up to date: indexes every repository, lays the
// world out, and re-indexes when a repository's HEAD moves.

// Full HEAD check of every repository, for anything the git watcher missed.
const FALLBACK_MS = 60_000
// Quiet time after a git write before checking, so one commit checks once.
const SETTLE_MS = 150
const UNCHANGED: IndexStats = { parsed: 0, reused: 0, skipped: 0, unchanged: true }

export function discoverRepos(project: ProjectConfig): string[] {
  if (project.kind !== 'repos') return [project.root]
  return readdirSync(project.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isGitRepo(join(project.root, entry.name)))
    .map((entry) => join(project.root, entry.name))
    .sort()
}

export interface RefreshResult {
  changed: boolean
  stats: IndexStats[]
}

export interface WatchOptions {
  fallbackMs?: number
  settleMs?: number
}

// The repositories a refresh checks: all of them, or only these roots plus
// any not indexed yet.
type RefreshScope = 'all' | ReadonlySet<string>

export interface ColonyOptions {
  // Lay the map out afresh on the first refresh instead of keeping the saved
  // order of modules and files.
  relayout?: boolean
}

export class Colony extends EventEmitter<{ update: [World] }> {
  private readonly cache: FactCache
  private readonly layoutPath: string
  private readonly indexes = new Map<string, RepoIndex>()
  private readonly lsp = new LspPool()
  private readonly parser = createParsePool()
  private readonly deep = new Map<string, Edge[]>()
  private current: World = { version: 0, indexedAt: '', languages: {}, nodes: [], edges: [] }
  private running: Promise<RefreshResult> | undefined
  private queued: Promise<RefreshResult> | undefined
  private pendingAll = false
  private readonly pendingRepos = new Set<string>()
  private watcher: HeadWatcherHandle | undefined
  private timer: NodeJS.Timeout | undefined
  private settleTimer: NodeJS.Timeout | undefined
  private relayout: boolean
  private readonly config: ColonyConfig

  constructor(config: ColonyConfig, { relayout = false }: ColonyOptions = {}) {
    super()
    this.config = config
    this.relayout = relayout
    this.cache = new FactCache(config.cacheDir, RULES_VERSION)
    this.layoutPath = join(config.cacheDir, 'layout.json')
  }

  get world(): World {
    return this.current
  }

  // Checks every repository's HEAD and re-indexes the ones that moved.
  refresh(): Promise<RefreshResult> {
    return this.schedule('all')
  }

  // Refreshes run one at a time. Requests made while one runs are merged
  // into the next, so a caller always sees git as it was when it asked.
  private schedule(scope: 'all' | readonly string[]): Promise<RefreshResult> {
    if (scope === 'all') this.pendingAll = true
    else for (const root of scope) this.pendingRepos.add(root)
    this.queued ??= (this.running ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        this.queued = undefined
        const next: RefreshScope = this.pendingAll ? 'all' : new Set(this.pendingRepos)
        this.pendingAll = false
        this.pendingRepos.clear()
        this.running = this.doRefresh(next).finally(() => {
          this.running = undefined
        })
        return this.running
      })
    return this.queued
  }

  private async doRefresh(scope: RefreshScope): Promise<RefreshResult> {
    const found = this.config.projects.map((project) => ({
      project,
      roots: discoverRepos(project),
    }))
    const toCheck = new Set(
      found.flatMap(({ project, roots }) =>
        roots.filter(
          (root) =>
            scope === 'all' || scope.has(root) || !this.indexes.has(`${project.name}\0${root}`),
        ),
      ),
    )
    const heads = await readHeadCommits([...toCheck])
    const projects: ProjectIndex[] = []
    const stats: IndexStats[] = []
    let changed = this.current.version === 0
    for (const { project, roots } of found) {
      const repos: RepoIndex[] = []
      for (const root of roots) {
        const key = `${project.name}\0${root}`
        const previous = this.indexes.get(key)
        if (previous && !heads.has(root)) {
          stats.push(UNCHANGED)
          repos.push(previous)
          continue
        }
        const result = await indexRepo(root, heads.get(root), this.cache, previous, this.parse)
        if (!result.stats.unchanged) changed = true
        this.indexes.set(key, result.index)
        stats.push(result.stats)
        repos.push(result.index)
      }
      projects.push({ name: project.name, repos })
    }
    const repoCount = projects.reduce((n, p) => n + p.repos.length, 0)
    if (repoCount !== this.indexes.size) {
      // A repository disappeared from a "repos" folder.
      changed = true
      const live = new Set(projects.flatMap((p) => p.repos.map((r) => `${p.name}\0${r.root}`)))
      for (const key of this.indexes.keys()) if (!live.has(key)) this.indexes.delete(key)
    }
    void this.syncWatcher()
    if (!changed) return { changed, stats }

    const { nodes, edges } = buildWorld(projects)
    const store = this.relayout ? emptyLayout() : loadLayout(this.layoutPath)
    this.relayout = false
    layoutWorld(nodes, edges, store)
    saveLayout(this.layoutPath, store)
    this.deep.clear()
    this.current = {
      version: this.current.version + 1,
      indexedAt: new Date().toISOString(),
      languages: Object.fromEntries(
        LANGUAGE_ADAPTERS.map((a) => [a.id, { semantic: a.languageServer !== undefined }]),
      ),
      nodes,
      edges,
    }
    this.emit('update', this.current)
    return { changed, stats }
  }

  // Re-indexes a repository soon after its HEAD moves: watches git's HEAD
  // and ref files, with a slow full check behind them. Resolves once the
  // indexed repositories are watched.
  watch({ fallbackMs = FALLBACK_MS, settleMs = SETTLE_MS }: WatchOptions = {}): Promise<void> {
    const check = (scope: 'all' | readonly string[]) => {
      this.schedule(scope).catch((error: unknown) => logError('Refresh failed', { error }))
    }
    const settle = () => {
      clearTimeout(this.settleTimer)
      this.settleTimer = setTimeout(() => check([]), settleMs)
      this.settleTimer.unref()
    }
    this.watcher = createHeadWatcher({
      onRepoChange: (repo) => {
        this.pendingRepos.add(repo)
        settle()
      },
      onFolderChange: settle,
    })
    this.timer = setInterval(() => check('all'), fallbackMs)
    this.timer.unref()
    return this.syncWatcher()
  }

  private async syncWatcher(): Promise<void> {
    const repos = [...new Set([...this.indexes.values()].map((index) => index.root))]
    const folders = this.config.projects.filter((p) => p.kind === 'repos').map((p) => p.root)
    try {
      await this.watcher?.sync(repos, folders)
    } catch (error) {
      logError('Git watch failed', { error })
    }
  }

  // Asks the file's language server for the outgoing calls of each of its
  // functions and methods: edges proven by LSP. Reads the working tree, so
  // the answers match HEAD only while the file is unmodified.
  async deepIndex(fileId: string): Promise<Edge[]> {
    const cached = this.deep.get(fileId)
    if (cached) return cached
    const version = this.current.version
    const file = this.current.nodes.find((node) => node.id === fileId && node.kind === 'file')
    const repo = this.repoOf(fileId)
    const adapter = file?.path ? findAdapter(file.path) : undefined
    if (!file?.path || !repo || !adapter?.languageServer) return []

    const symbols = this.current.nodes.filter(
      (node) =>
        node.kind === 'symbol' &&
        node.id.startsWith(`${fileId}#`) &&
        (node.symbolKind === 'function' || node.symbolKind === 'method'),
    )
    const facts = repo.index.files.find((f) => f.path === file.path)?.facts.symbols ?? []
    const edges: Edge[] = []
    const path = join(repo.index.root, file.path)
    await this.lsp.use(adapter.id, adapter.languageServer, repo.index.root, async (session) => {
      for (const symbol of symbols) {
        const fact = facts.find((f) => `${fileId}#${qualifiedName(f)}` === symbol.id)
        if (!fact) continue
        const calls = await session.outgoingCalls(
          { path, line: fact.at.line, column: fact.at.column },
          fact.name,
        )
        for (const call of calls) {
          const target = this.symbolAt(
            repo,
            relative(repo.index.root, call.target.path),
            call.target.line,
            call.name,
          )
          if (!target || target === symbol.id) continue
          edges.push({
            from: symbol.id,
            to: target,
            kind: 'call',
            provenance: 'lsp',
            label: call.name,
            at: { file: fileId, line: call.lines[0] ?? fact.at.line },
          })
        }
      }
    })
    if (this.current.version === version) this.deep.set(fileId, edges)
    return edges
  }

  // A file on the map, as committed at the indexed commit. Ids name files in
  // the index only, so no path from the page ever reaches the filesystem.
  async readFile(fileId: string): Promise<FileResponse | undefined> {
    const file = this.current.nodes.find((node) => node.id === fileId && node.kind === 'file')
    const repo = this.repoOf(fileId)
    const indexed = repo?.index.files.find((f) => f.path === file?.path)
    if (!file?.path || !repo || !indexed) return undefined
    const base = { id: fileId, path: file.path, commit: repo.index.commit }
    if (file.language === 'binary') return { ...base, isBinary: true, text: '' }
    const blob = (await readBlobs(repo.index.root, [indexed.sha])).get(indexed.sha)
    if (!blob) return undefined
    return { ...base, isBinary: false, text: blob.toString('utf8') }
  }

  async close(): Promise<void> {
    clearInterval(this.timer)
    clearTimeout(this.settleTimer)
    this.watcher?.close()
    await Promise.all([this.lsp.close(), this.parser.close()])
  }

  // A worker that dies on a file (out of memory, a grammar crash) leaves that
  // file's size on the map for this index only: the failure may not happen
  // again, so the file is parsed afresh next time instead of cached.
  private readonly parse: ParseBlob = (path, bytes) =>
    this.parser.parse(path, bytes).then(
      (facts) => ({ facts, provisional: false }),
      (error: unknown) => {
        if (!(error instanceof ParsePoolError) || error.code === 'Closed') throw error
        logError('Parse worker failed', { path, error })
        return { facts: buildTextFacts(bytes), provisional: true }
      },
    )

  private repoOf(nodeId: string): { id: string; index: RepoIndex } | undefined {
    for (const [key, index] of this.indexes) {
      const id = repoId(key.slice(0, key.indexOf('\0')), index.name)
      if (nodeId.startsWith(`${id}/`)) return { id, index }
    }
    return undefined
  }

  private symbolAt(
    repo: { id: string; index: RepoIndex },
    path: string,
    line: number,
    name: string,
  ): string | undefined {
    const file = repo.index.files.find((f) => f.path === path)
    if (!file) return undefined
    const symbol = file.facts.symbols.find((s) => s.at.line === line && s.name === name)
    return symbol ? `${repo.id}/${path}#${qualifiedName(symbol)}` : undefined
  }
}
