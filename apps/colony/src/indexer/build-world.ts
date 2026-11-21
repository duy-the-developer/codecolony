import { posix } from 'node:path'
import { findAdapter } from '../adapters/registry.ts'
import { pathsMatch } from '../core/http-paths.ts'
import { type Edge, qualifiedName, type TransportFact } from '../core/model.ts'
import { WORLD_ID, type WorldNode } from '../shared/world-types.ts'
import type { RepoIndex } from './repo.ts'

// Turns repository indexes into the world tree (world > project > repo >
// package > module > file > symbol) and the edges between its nodes. A module
// is one folder's own files; its subfolders are modules of their own, in the
// same package unless they hold a manifest. Rectangles are filled in by the
// layout.

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

export function projectId(project: string): string {
  return `project:${project}`
}

export function repoId(project: string, repo: string): string {
  return `${projectId(project)}/${repo}`
}

// Package ids cannot clash with module or file ids: no path starts with
// "package:" in practice, and the repository root module is "<repo>/.".
export function packageId(repo: string, pkg: string): string {
  return `${repo}/package:${pkg}`
}

export function moduleId(repo: string, dir: string): string {
  return `${repo}/${dir}`
}

export function buildWorld(projects: ProjectIndex[]): { nodes: WorldNode[]; edges: Edge[] } {
  const nodes: WorldNode[] = [
    { id: WORLD_ID, kind: 'world', name: 'world', lines: 0, complexity: 0, rect: ZERO },
  ]
  const edges: Edge[] = []
  const clients: { file: string; fact: TransportFact }[] = []
  const routes: { file: string; fact: TransportFact }[] = []

  for (const project of projects) {
    const id = projectId(project.name)
    nodes.push({
      id,
      parent: WORLD_ID,
      kind: 'project',
      name: project.name,
      lines: 0,
      complexity: 0,
      rect: ZERO,
    })
    for (const repo of project.repos) {
      const rid = repoId(project.name, repo.name)
      const repoNode: WorldNode = {
        id: rid,
        parent: id,
        kind: 'repo',
        name: repo.name,
        lines: 0,
        complexity: 0,
        rect: ZERO,
      }
      if (repo.commit) repoNode.commit = repo.commit
      nodes.push(repoNode)
      addRepo(repo, rid, nodes, edges)
      for (const file of repo.files) {
        for (const fact of file.facts.transports) {
          if (fact.kind === 'http-client') clients.push({ file: `${rid}/${file.path}`, fact })
          if (fact.kind === 'http-route') routes.push({ file: `${rid}/${file.path}`, fact })
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
  const manifestDirs = new Set<string>()
  const moduleDirs = new Set<string>()
  for (const { path } of repo.files) {
    if (MANIFESTS.has(posix.basename(path))) manifestDirs.add(posix.dirname(path))
    moduleDirs.add(posix.dirname(path))
  }
  // The nearest folder with a manifest at or above dir, or '.' for the rest
  // of the repository.
  const packageOf = (dir: string): string => {
    for (let at = dir; at !== '.'; at = posix.dirname(at)) if (manifestDirs.has(at)) return at
    return '.'
  }
  const modules = [...moduleDirs].sort().map((dir) => ({ dir, pkg: packageOf(dir) }))
  for (const pkg of [...new Set(modules.map((m) => m.pkg))].sort()) {
    const node: WorldNode = {
      id: packageId(id, pkg),
      parent: id,
      kind: 'package',
      name: pkg === '.' ? '(repo root)' : pkg,
      lines: 0,
      complexity: 0,
      rect: ZERO,
    }
    if (pkg !== '.') node.path = pkg
    if (manifestDirs.has(pkg)) node.package = true
    nodes.push(node)
  }
  for (const { dir, pkg } of modules) {
    const node: WorldNode = {
      id: moduleId(id, dir),
      parent: packageId(id, pkg),
      kind: 'module',
      name: dir === pkg ? (pkg === '.' ? '/' : '(package root)') : posix.relative(pkg, dir),
      lines: 0,
      complexity: 0,
      rect: ZERO,
    }
    if (dir !== '.') node.path = dir
    nodes.push(node)
  }

  for (const file of repo.files) {
    const fileId = `${id}/${file.path}`
    const { facts } = file
    const node: WorldNode = {
      id: fileId,
      parent: moduleId(id, posix.dirname(file.path)),
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
    const adapter = findAdapter(file.path)
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
