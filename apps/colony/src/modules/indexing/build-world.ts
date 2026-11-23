import { posix } from 'node:path'
import { findAdapter } from '../language/registry.ts'
import { type Edge, qualifiedName, type TransportFact } from '../world/facts.ts'
import { WORLD_ID, type WorldNode } from '../world/world-types.ts'
import { pathsMatch } from './http-paths.ts'
import type { RepoIndex } from './repo.ts'

// Turns repository indexes into the world tree (world > project > repo >
// package > module > file > symbol) and the edges between its nodes. A module
// is a folder: it holds its own files and its subfolders' modules, in the
// same package unless they hold a manifest. A folder with no files of its own
// and a single subfolder merges into it, so "src/web" is one module rather
// than an empty "src" around "web". Files directly in a repository's or a
// package's own folder belong to that repository or package, with no module
// around them. Rectangles are filled in by the layout.

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
// "package:" in practice.
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
      addRepo(repo, repoNode, nodes, edges)
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

function addRepo(repo: RepoIndex, repoNode: WorldNode, nodes: WorldNode[], edges: Edge[]): void {
  const { id } = repoNode
  const paths = new Set(repo.files.map((file) => file.path))
  const manifestDirs = new Set<string>()
  const dirs = new Set<string>()
  for (const { path } of repo.files) {
    if (MANIFESTS.has(posix.basename(path))) manifestDirs.add(posix.dirname(path))
    dirs.add(posix.dirname(path))
  }
  if (manifestDirs.has('.')) repoNode.package = true
  // The nearest folder below the root with a manifest, at or above dir.
  const packageOf = (dir: string): string | undefined => {
    for (let at = dir; at !== '.'; at = posix.dirname(at)) if (manifestDirs.has(at)) return at
    return undefined
  }
  // The node that holds a folder's own files: the repository or package it
  // is the root of, or the module it is.
  const holderOf = (dir: string): string => {
    if (dir === '.') return id
    const pkg = packageOf(dir)
    return pkg === dir ? packageId(id, pkg) : moduleId(id, dir)
  }
  for (const pkg of [...manifestDirs].filter((dir) => dir !== '.').sort()) {
    nodes.push({
      id: packageId(id, pkg),
      parent: id,
      kind: 'package',
      name: pkg,
      path: pkg,
      lines: 0,
      complexity: 0,
      rect: ZERO,
      package: true,
    })
  }
  // Every folder between a module's files and its repository or package root,
  // with the subfolders below each.
  const baseOf = (dir: string): string => packageOf(dir) ?? '.'
  const folders = new Set<string>()
  const subfolders = new Map<string, number>()
  for (const dir of dirs) {
    if (holderOf(dir) !== moduleId(id, dir)) continue
    const base = baseOf(dir)
    for (let at = dir; at !== base && !folders.has(at); at = posix.dirname(at)) {
      folders.add(at)
      const up = posix.dirname(at)
      subfolders.set(up, (subfolders.get(up) ?? 0) + 1)
    }
  }
  const isModule = (dir: string) => dirs.has(dir) || (subfolders.get(dir) ?? 0) > 1
  for (const dir of [...folders].sort()) {
    if (!isModule(dir)) continue
    const base = baseOf(dir)
    let up = posix.dirname(dir)
    while (up !== base && !isModule(up)) up = posix.dirname(up)
    const parent = up === base ? (base === '.' ? id : packageId(id, base)) : moduleId(id, up)
    nodes.push({
      id: moduleId(id, dir),
      parent,
      kind: 'module',
      name: up === '.' ? dir : posix.relative(up, dir),
      path: dir,
      lines: 0,
      complexity: 0,
      rect: ZERO,
    })
  }

  for (const file of repo.files) {
    const fileId = `${id}/${file.path}`
    const { facts } = file
    const node: WorldNode = {
      id: fileId,
      parent: holderOf(posix.dirname(file.path)),
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
    // One import edge per target file; it is type-only when every import of
    // that file is.
    const imported = new Map<string, Edge>()
    for (const fact of file.facts.imports) {
      const target = adapter?.resolveImport(fact.specifier, file.path, paths)
      if (!target) continue
      for (const name of fact.names) bound.set(name, target)
      const known = imported.get(target)
      if (known) {
        if (!fact.typeOnly) known.typeOnly = false
        continue
      }
      const edge: Edge = {
        from: fileId,
        to: `${id}/${target}`,
        kind: 'import',
        provenance: 'tree-sitter',
        label: fact.specifier,
        at: { file: fileId, line: fact.line },
        typeOnly: fact.typeOnly,
      }
      imported.set(target, edge)
      edges.push(edge)
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
