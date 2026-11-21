import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { findAdapter, LANGUAGE_ADAPTERS, RULES_VERSION } from '../adapters/registry.ts'
import type { ColonyConfig, ProjectConfig } from '../config/load-config.ts'
import type { LanguageAdapter } from '../core/language-adapter.ts'
import { LspSession } from '../core/lsp.ts'
import { type Edge, qualifiedName } from '../core/model.ts'
import { layoutWorld, loadLayout, saveLayout } from '../layout/world-layout.ts'
import { logError } from '../shared/log.ts'
import type { World } from '../shared/world-types.ts'
import { buildWorld, type ProjectIndex, repoId } from './build-world.ts'
import { FactCache } from './cache.ts'
import { isGitRepo } from './git.ts'
import { type IndexStats, indexRepo, type RepoIndex } from './repo.ts'

// Keeps the world for a config up to date: indexes every repository, lays the
// world out, and re-indexes when a repository's HEAD moves.

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

export class Colony extends EventEmitter<{ update: [World] }> {
  private readonly cache: FactCache
  private readonly layoutPath: string
  private readonly indexes = new Map<string, RepoIndex>()
  private readonly lsp = new Map<string, Promise<LspSession>>()
  private readonly deep = new Map<string, Edge[]>()
  private current: World = { version: 0, indexedAt: '', languages: {}, nodes: [], edges: [] }
  private refreshing: Promise<RefreshResult> | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly config: ColonyConfig) {
    super()
    this.cache = new FactCache(config.cacheDir, RULES_VERSION)
    this.layoutPath = join(config.cacheDir, 'layout.json')
  }

  get world(): World {
    return this.current
  }

  // Concurrent callers share one refresh.
  refresh(): Promise<RefreshResult> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<RefreshResult> {
    const projects: ProjectIndex[] = []
    const stats: IndexStats[] = []
    let changed = this.current.version === 0
    for (const project of this.config.projects) {
      const repos: RepoIndex[] = []
      const roots = discoverRepos(project)
      for (const root of roots) {
        const key = `${project.name}\0${root}`
        const result = await indexRepo(root, this.cache, this.indexes.get(key))
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
    if (!changed) return { changed, stats }

    const { nodes, edges } = buildWorld(projects)
    const store = loadLayout(this.layoutPath)
    layoutWorld(nodes, store)
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

  // Polls every repository's HEAD and refreshes when one moves.
  watch(intervalMs: number): void {
    this.timer = setInterval(() => {
      this.refresh().catch((error: unknown) => logError('Refresh failed', { error }))
    }, intervalMs)
    this.timer.unref()
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

    const session = await this.session(repo.index.root, adapter)
    const symbols = this.current.nodes.filter(
      (node) =>
        node.kind === 'symbol' &&
        node.id.startsWith(`${fileId}#`) &&
        (node.symbolKind === 'function' || node.symbolKind === 'method'),
    )
    const facts = repo.index.files.find((f) => f.path === file.path)?.facts.symbols ?? []
    const edges: Edge[] = []
    for (const symbol of symbols) {
      const fact = facts.find((f) => `${fileId}#${qualifiedName(f)}` === symbol.id)
      if (!fact) continue
      const calls = await session.outgoingCalls(
        { path: join(repo.index.root, file.path), line: fact.at.line, column: fact.at.column },
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
    if (this.current.version === version) this.deep.set(fileId, edges)
    return edges
  }

  async close(): Promise<void> {
    clearInterval(this.timer)
    const sessions = await Promise.allSettled(this.lsp.values())
    await Promise.all(sessions.map((s) => (s.status === 'fulfilled' ? s.value.close() : undefined)))
    this.lsp.clear()
  }

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

  private session(root: string, adapter: LanguageAdapter): Promise<LspSession> {
    const key = `${adapter.id}\0${root}`
    let session = this.lsp.get(key)
    if (!session) {
      if (!adapter.languageServer)
        return Promise.reject(new Error(`${adapter.id}: no language server`))
      session = LspSession.start(adapter.languageServer, root)
      session.catch(() => this.lsp.delete(key))
      this.lsp.set(key, session)
    }
    return session
  }
}
