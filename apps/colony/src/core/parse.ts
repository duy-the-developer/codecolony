import { Language, type Node, Parser, Query, type Tree } from 'web-tree-sitter'
import type { LanguageAdapter, TransportDetector } from './language-adapter.ts'
import {
  type CallFact,
  type FileFacts,
  type ImportFact,
  qualifiedName,
  SYMBOL_KINDS,
  type SymbolFact,
  type SymbolKind,
} from './model.ts'

// Runs an adapter's tree-sitter grammar and queries over one file and turns
// the captures into language-agnostic FileFacts.

let init: Promise<void> | undefined
const languages = new Map<string, Promise<Language>>()
const queries = new WeakMap<Language, Map<string, Query>>()

async function loadLanguage(wasmPath: string): Promise<Language> {
  init ??= Parser.init()
  await init
  let language = languages.get(wasmPath)
  if (!language) {
    language = Language.load(wasmPath)
    languages.set(wasmPath, language)
  }
  return language
}

function compile(language: Language, source: string): Query {
  let cache = queries.get(language)
  if (!cache) {
    cache = new Map()
    queries.set(language, cache)
  }
  let query = cache.get(source)
  if (!query) {
    query = new Query(language, source)
    cache.set(source, query)
  }
  return query
}

export function countLines(source: string): number {
  if (source === '') return 0
  let lines = 1
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) lines++
  return source.endsWith('\n') ? lines - 1 : lines
}

// Facts for a file no adapter understands: size only.
export function textFacts(source: string): FileFacts {
  return {
    language: 'text',
    lines: countLines(source),
    complexity: 0,
    symbols: [],
    imports: [],
    calls: [],
    transports: [],
  }
}

export async function parseFile(
  adapter: LanguageAdapter,
  detectors: readonly TransportDetector[],
  path: string,
  source: string,
): Promise<FileFacts> {
  const language = await loadLanguage(adapter.grammar(path))
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  parser.delete()
  if (!tree) throw new Error(`${path}: tree-sitter returned no tree`)
  try {
    const branches = branchOffsets(tree, adapter)
    const definitions = readDefinitions(tree, language, adapter, branches)
    const transports = detectors
      .filter((detector) => detector.languages.includes(adapter.id))
      .flatMap((detector) =>
        detector.detect(tree, { path, query: (src) => compile(language, src) }),
      )
    return {
      language: adapter.id,
      lines: countLines(source),
      complexity: branches.length,
      symbols: definitions.map((d) => d.symbol),
      imports: readImports(tree, language, adapter),
      calls: readCalls(tree, language, adapter, definitions),
      transports,
    }
  } finally {
    tree.delete()
  }
}

// Start offsets of branch nodes, in document order.
function branchOffsets(tree: Tree, adapter: LanguageAdapter): number[] {
  const offsets: number[] = []
  const cursor = tree.walk()
  const current = () => cursor.currentNode
  let descend = true
  for (;;) {
    if (descend && cursor.gotoFirstChild()) {
      if (adapter.isBranch(cursor.nodeType, current)) offsets.push(cursor.startIndex)
      continue
    }
    if (cursor.gotoNextSibling()) {
      descend = true
      if (adapter.isBranch(cursor.nodeType, current)) offsets.push(cursor.startIndex)
      continue
    }
    if (!cursor.gotoParent()) break
    descend = false
  }
  cursor.delete()
  return offsets
}

function countBetween(sorted: number[], start: number, end: number): number {
  return lowerBound(sorted, end) - lowerBound(sorted, start)
}

function lowerBound(sorted: number[], value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] ?? 0) < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

interface Definition {
  start: number
  end: number
  qualified: string
  symbol: SymbolFact
}

function readDefinitions(
  tree: Tree,
  language: Language,
  adapter: LanguageAdapter,
  branches: number[],
): Definition[] {
  const found: { node: Node; name: Node; kind: SymbolKind }[] = []
  for (const match of compile(language, adapter.queries.symbols).matches(tree.rootNode)) {
    const definition = match.captures.find((c) => c.name.startsWith('definition.'))
    const name = match.captures.find((c) => c.name === 'name')
    if (!definition || !name) continue
    const suffix = definition.name.slice('definition.'.length)
    const kind = adapter.symbolKind
      ? adapter.symbolKind(suffix, definition.node)
      : SYMBOL_KINDS.find((k) => k === suffix)
    if (kind) found.push({ node: definition.node, name: name.node, kind })
  }
  found.sort((a, b) => a.node.startIndex - b.node.startIndex || b.node.endIndex - a.node.endIndex)

  const definitions: Definition[] = []
  const seen = new Set<string>()
  const stack: Definition[] = []
  for (const { node, name, kind } of found) {
    while (stack.length > 0 && (stack.at(-1)?.end ?? 0) <= node.startIndex) stack.pop()
    const container = stack.at(-1)
    const symbol: SymbolFact = {
      name: name.text,
      kind,
      range: { start: node.startPosition.row + 1, end: node.endPosition.row + 1 },
      at: { line: name.startPosition.row + 1, column: name.startPosition.column },
      exported: adapter.isExported?.(node) ?? false,
      complexity: countBetween(branches, node.startIndex, node.endIndex),
    }
    if (container) symbol.container = container.symbol.name
    const definition: Definition = {
      start: node.startIndex,
      end: node.endIndex,
      qualified: qualifiedName(symbol),
      symbol,
    }
    stack.push(definition)
    // Overloads and re-declarations keep the first occurrence.
    if (seen.has(definition.qualified)) continue
    seen.add(definition.qualified)
    definitions.push(definition)
  }
  return definitions
}

// Several query patterns may match one statement (one for the source, one per
// bound name); they are merged by statement.
function readImports(tree: Tree, language: Language, adapter: LanguageAdapter): ImportFact[] {
  const byStatement = new Map<number, { statement: Node; specifier?: string; names: string[] }>()
  for (const match of compile(language, adapter.queries.imports).matches(tree.rootNode)) {
    const statement = match.captures.find((c) => c.name === 'import')?.node
    if (!statement) continue
    let entry = byStatement.get(statement.id)
    if (!entry) {
      entry = { statement, names: [] }
      byStatement.set(statement.id, entry)
    }
    for (const { name, node } of match.captures) {
      if (name === 'import.source') entry.specifier = node.text.replace(/^['"`]|['"`]$/g, '')
      else if (name === 'import.name' && !entry.names.includes(node.text))
        entry.names.push(node.text)
    }
  }
  const imports: ImportFact[] = []
  for (const { statement, specifier, names } of byStatement.values()) {
    if (specifier === undefined) continue
    imports.push({
      specifier,
      names,
      line: statement.startPosition.row + 1,
      typeOnly: adapter.isTypeOnlyImport?.(statement) ?? false,
    })
  }
  return imports.sort((a, b) => a.line - b.line)
}

function readCalls(
  tree: Tree,
  language: Language,
  adapter: LanguageAdapter,
  definitions: Definition[],
): CallFact[] {
  const calls: CallFact[] = []
  for (const match of compile(language, adapter.queries.calls).matches(tree.rootNode)) {
    const call = match.captures.find((c) => c.name === 'call')?.node
    const name = match.captures.find((c) => c.name === 'call.name')?.node
    if (!call || !name) continue
    const fact: CallFact = {
      callee: name.text,
      line: call.startPosition.row + 1,
      bare: !match.captures.some((c) => c.name === 'call.member'),
    }
    const caller = innermost(definitions, call.startIndex)
    if (caller) fact.caller = caller.qualified
    calls.push(fact)
  }
  return calls
}

function innermost(definitions: Definition[], offset: number): Definition | undefined {
  let best: Definition | undefined
  for (const d of definitions) {
    if (d.start <= offset && offset < d.end && (!best || d.end - d.start < best.end - best.start))
      best = d
  }
  return best
}
