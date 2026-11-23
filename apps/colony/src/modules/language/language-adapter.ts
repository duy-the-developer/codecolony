import type { Node, Query, Tree } from 'web-tree-sitter'
import type { SymbolKind, TransportFact } from '../world/facts.ts'

// A language plugs into Code Colony through one LanguageAdapter. It has two
// halves:
// - a parser side: a tree-sitter grammar plus queries that the core runs to
//   read declarations, imports and calls (parse.ts);
// - an optional semantic side: a language server the core drives over stdio
//   with the Language Server Protocol (lsp.ts).
// Adding a language means a new adapter, a grammar and a server command; the
// core, the indexer, the layout and the renderer stay as they are.
// See ARCHITECTURE.md for the capture names and the contract test.

export interface LanguageAdapter {
  // Stable id, stored with cached facts, for example 'typescript'.
  id: string
  // Bump when the queries or hooks change, so cached facts are re-read.
  version: number
  // File extensions this adapter claims, with the dot: ['.ts', '.tsx'].
  extensions: readonly string[]
  // Absolute path of the tree-sitter grammar (.wasm) for a file.
  grammar(path: string): string
  queries: AdapterQueries
  // True for syntax nodes that add a branch (if, loop, case, catch, &&, ...).
  // Called for every node of every file, so decide from the node type when
  // possible: node() builds the full node, which is several times slower.
  isBranch(type: string, node: () => Node): boolean
  // Maps a symbol query capture suffix (definition.<suffix>) to a kind.
  // Defaults to the suffix itself when it is a SymbolKind.
  symbolKind?(suffix: string, node: Node): SymbolKind | undefined
  // True when the declaration node is exported from its file.
  isExported?(declaration: Node): boolean
  // True when an import statement only brings in types.
  isTypeOnlyImport?(statement: Node): boolean
  // Builds the specifier of a name imported from a module when that name may
  // itself be a module (Python `from pkg import mod`), from the
  // @import.source and @import.member captures.
  importSpecifier?(source: string, member: string): string
  // Resolves an import specifier to a repository-relative file path, or
  // undefined for packages outside the repository.
  resolveImport(specifier: string, fromPath: string, files: ReadonlySet<string>): string | undefined
  languageServer?: LanguageServerSpec
}

// Tree-sitter queries with the capture names the core reads.
export interface AdapterQueries {
  // @definition.<kind> on the declaration, @name on its name. The nearest
  // enclosing definition becomes the container (class for a method).
  symbols: string
  // @import on the statement, @import.source on the module string (quotes
  // are stripped), @import.name on each bound local name. With an
  // importSpecifier hook, @import.member on a name that may be a module; put
  // @import on that name so each one becomes its own import.
  imports: string
  // @call on the call expression, @call.name on the called identifier,
  // @call.member when it is a member call (x.f()).
  calls: string
}

export interface LanguageServerSpec {
  // argv of a server that speaks LSP over stdio.
  command(): string[]
  // LSP languageId for a file, for textDocument/didOpen.
  languageId(path: string): string
  initializationOptions?(): unknown
}

// Finds transport facts (HTTP, queues, data access) in one parsed file. A
// detector names the languages it understands; frameworks and libraries get
// their own detectors.
export interface TransportDetector {
  id: string
  version: number
  languages: readonly string[]
  detect(tree: Tree, ctx: DetectContext): TransportFact[]
}

export interface DetectContext {
  path: string
  // Compiles a query against the file's grammar (cached by source).
  query(source: string): Query
}
