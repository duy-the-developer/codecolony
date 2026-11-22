// The language-agnostic model. Nothing here knows about a specific language:
// language adapters (language/adapters) turn source files into these facts.

// How a fact was established, strongest first.
// lsp: answered by a language server (definitions, references, call hierarchy).
// tree-sitter: read from the syntax tree (declarations, imports, bound names).
// text: matched on source text or literals (URL paths, topic names).
// inferred: guessed from a naming rule or convention.
export const PROVENANCES = ['lsp', 'tree-sitter', 'text', 'inferred'] as const
export type Provenance = (typeof PROVENANCES)[number]
// Provenances that prove a link rather than guess it.
export const PROVEN_PROVENANCES: ReadonlySet<Provenance> = new Set(['lsp', 'tree-sitter'])

export const SYMBOL_KINDS = [
  'function',
  'method',
  'class',
  'interface',
  'type',
  'enum',
  'variable',
  'namespace',
] as const
export type SymbolKind = (typeof SYMBOL_KINDS)[number]

// Lines are 1-based and inclusive.
export interface LineRange {
  start: number
  end: number
}

export interface SymbolFact {
  name: string
  kind: SymbolKind
  range: LineRange
  // Position of the name: 1-based line, 0-based column (UTF-16 units, as LSP).
  at: { line: number; column: number }
  // Name of the enclosing symbol (a class for a method), if any.
  container?: string
  exported: boolean
  // Branch count inside the symbol: a rough complexity measure.
  complexity: number
}

export interface ImportFact {
  // The module as written, for example './config' or 'node:fs'.
  specifier: string
  // Local names the import binds; used to resolve calls to imported symbols.
  names: string[]
  line: number
  typeOnly: boolean
}

export interface CallFact {
  // The called name as written (the last identifier of a member chain).
  callee: string
  // Qualified name of the symbol the call sits in; absent at file top level.
  caller?: string
  line: number
  // True for a plain identifier call (f()), false for a member call (x.f()).
  bare: boolean
}

export const TRANSPORT_KINDS = [
  'http-client',
  'http-route',
  'queue-produce',
  'queue-consume',
  'data-read',
  'data-write',
] as const
export type TransportKind = (typeof TRANSPORT_KINDS)[number]

// A place where a file talks across a process boundary.
export interface TransportFact {
  kind: TransportKind
  // An HTTP path or URL, a topic, a table or collection name.
  target: string
  // HTTP method when known, upper case.
  method?: string
  line: number
  // The detector that found it, for proof tags in the inspector.
  detector: string
  provenance: Provenance
}

// Everything the indexer keeps about one file. Cached by content hash.
export interface FileFacts {
  // Adapter id, or 'text' for files no adapter understands.
  language: string
  lines: number
  complexity: number
  symbols: SymbolFact[]
  imports: ImportFact[]
  calls: CallFact[]
  transports: TransportFact[]
}

export const EDGE_KINDS = ['import', 'call', 'http', 'queue', 'data'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export interface Edge {
  from: string
  to: string
  kind: EdgeKind
  provenance: Provenance
  // Short description: an endpoint, a topic, an imported specifier.
  label?: string
  // Where the evidence is: a world node id (file) and a line.
  at?: { file: string; line: number }
  typeOnly?: boolean
}

export function qualifiedName(symbol: Pick<SymbolFact, 'name' | 'container'>): string {
  return symbol.container ? `${symbol.container}.${symbol.name}` : symbol.name
}
