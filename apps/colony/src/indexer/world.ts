import { posix } from 'node:path'
import { adapterFor } from '../adapters/index.ts'
import { pathsMatch } from '../core/http.ts'
import { type Edge, qualifiedName, type TransportFact } from '../core/model.ts'
import { WORLD_ID, type WorldNode } from '../shared/world.ts'
import type { RepoIndex } from './repo.ts'

// Turns repository indexes into the world tree (world > project > repo > dir
// > file > symbol) and the edges between its nodes. Rectangles are filled in
// by the layout.

export interface ProjectIndex {
  name: string
  repos: RepoIndex[]
}

const MANIFESTS = new Set([
  'package.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'mix.exs',
])

const ZERO = { x: 0, y: 0, w: 0, h: 0 }

export function repoId(project: string, repo: string): string {
  return `${project}/${repo}`
}

export function buildWorld(projects: ProjectIndex[]): { nodes: WorldNode[]; edges: Edge[] } {
  const nodes: WorldNode[] = [
    { id: WORLD_ID, kind: 'world', name: 'world', lines: 0, complexity: 0, rect: ZERO },
  ]
  const edges: Edge[] = []
  const clients: { file: string; fact: TransportFact }[] = []
  const routes: { file: string; fact: TransportFact }[] = []

  for (const project of projects) {
    const projectId = project.name
    nodes.push({
      id: projectId,
      parent: WORLD_ID,
      kind: 'project',
      name: project.name,
      lines: 0,
      complexity: 0,
      rect: ZERO,
    })
    for (const repo of project.repos) {
      const id = repoId(project.name, repo.name)
      const repoNode: WorldNode = {
        id,
        parent: projectId,
        kind: 'repo',
        name: repo.name,
        lines: 0,
        complexity: 0,
        rect: ZERO,
      }
      if (repo.commit) repoNode.commit = repo.commit
      nodes.push(repoNode)
      addRepo(repo, id, nodes, edges)
      for (const file of repo.files) {
        for (const fact of file.facts.transports) {
          if (fact.kind === 'http-client') clients.push({ file: `${id}/${file.path}`, fact })
          if (fact.kind === 'http-route') routes.push({ file: `${id}/${file.path}`, fact })
        }
      }
    }
  }

  for (const client of clients) {
    for (const route of routes) {
      if (client.file === route.file) continue
      if (client.fact.method && route.fact.method && client.fact.method !== route.fact.method)
        continue
      if (!pathsMatch(client.fact.target, route.fact.target)) continue
      edges.push({
        from: client.file,
        to: route.file,
        kind: 'http',
        provenance: 'text',
        label: `${route.fact.method ?? client.fact.method ?? ''} ${route.fact.target}`.trim(),
        at: { file: client.file, line: client.fact.line },
      })
    }
  }

  sumUp(nodes)
  return { nodes, edges }
}

function addRepo(repo: RepoIndex, id: string, nodes: WorldNode[], edges: Edge[]): void {
  const paths = new Set(repo.files.map((file) => file.path))
  const dirs = new Set<string>()
  const manifestDirs = new Set<string>()
  for (const { path } of repo.files) {
    if (MANIFESTS.has(posix.basename(path))) manifestDirs.add(posix.dirname(path))
    for (let dir = posix.dirname(path); dir !== '.'; dir = posix.dirname(dir)) {
      if (dirs.has(dir)) break
      dirs.add(dir)
    }
  }
  const parentOf = (path: string): string => {
    const dir = posix.dirname(path)
    return dir === '.' ? id : `${id}/${dir}`
  }
  for (const dir of [...dirs].sort()) {
    const node: WorldNode = {
      id: `${id}/${dir}`,
      parent: parentOf(dir),
      kind: 'dir',
      name: posix.basename(dir),
      path: dir,
      lines: 0,
      complexity: 0,
      rect: ZERO,
    }
    if (manifestDirs.has(dir)) node.package = true
    nodes.push(node)
  }

  for (const file of repo.files) {
    const fileId = `${id}/${file.path}`
    const { facts } = file
    const node: WorldNode = {
      id: fileId,
      parent: parentOf(file.path),
      kind: 'file',
      name: posix.basename(file.path),
      path: file.path,
      lines: facts.lines,
      complexity: facts.complexity,
      rect: ZERO,
      language: facts.language,
    }
    if (facts.transports.length > 0) node.transports = facts.transports
    nodes.push(node)
    for (const symbol of facts.symbols) {
      const qualified = qualifiedName(symbol)
      nodes.push({
        id: `${fileId}#${qualified}`,
        parent: symbol.container ? `${fileId}#${symbol.container}` : fileId,
        kind: 'symbol',
        name: symbol.name,
        path: file.path,
        lines: symbol.range.end - symbol.range.start + 1,
        complexity: symbol.complexity,
        rect: ZERO,
        symbolKind: symbol.kind,
        range: symbol.range,
        exported: symbol.exported,
      })
    }
  }
  // A container name can be ambiguous (two classes with one name); symbols
  // whose container is not a node hang off the file instead.
  const ids = new Set(nodes.map((node) => node.id))
  for (const node of nodes) {
    if (node.kind === 'symbol' && node.parent && !ids.has(node.parent)) {
      node.parent = node.id.slice(0, node.id.indexOf('#'))
    }
  }

  addCodeEdges(repo, id, paths, edges)
}

function addCodeEdges(repo: RepoIndex, id: string, paths: Set<string>, edges: Edge[]): void {
  const topLevel = new Map<string, Set<string>>()
  for (const file of repo.files) {
    topLevel.set(
      file.path,
      new Set(file.facts.symbols.filter((s) => !s.container).map((s) => s.name)),
    )
  }
  for (const file of repo.files) {
    const fileId = `${id}/${file.path}`
    const adapter = adapterFor(file.path)
    // Local name -> file it was imported from.
    const bound = new Map<string, string>()
    for (const fact of file.facts.imports) {
      const target = adapter?.resolveImport(fact.specifier, file.path, paths)
      if (!target) continue
      edges.push({
        from: fileId,
        to: `${id}/${target}`,
        kind: 'import',
        provenance: 'tree-sitter',
        label: fact.specifier,
        at: { file: fileId, line: fact.line },
        typeOnly: fact.typeOnly,
      })
      for (const name of fact.names) bound.set(name, target)
    }
    const seen = new Set<string>()
    const local = topLevel.get(file.path) ?? new Set()
    for (const call of file.facts.calls) {
      if (!call.bare) continue
      let target: string | undefined
      if (local.has(call.callee)) target = `${fileId}#${call.callee}`
      else {
        const from = bound.get(call.callee)
        if (from && topLevel.get(from)?.has(call.callee)) target = `${id}/${from}#${call.callee}`
      }
      const source = call.caller ? `${fileId}#${call.caller}` : fileId
      if (!target || target === source || seen.has(`${source}>${target}`)) continue
      seen.add(`${source}>${target}`)
      edges.push({
        from: source,
        to: target,
        kind: 'call',
        provenance: 'tree-sitter',
        label: call.callee,
        at: { file: fileId, line: call.line },
      })
    }
  }
}

// Containers carry the total lines and complexity of what they hold.
function sumUp(nodes: WorldNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of [...nodes].reverse()) {
    if (node.kind !== 'file') continue
    for (let parent = byId.get(node.parent ?? ''); parent; parent = byId.get(parent.parent ?? '')) {
      parent.lines += node.lines
      parent.complexity += node.complexity
    }
  }
}
