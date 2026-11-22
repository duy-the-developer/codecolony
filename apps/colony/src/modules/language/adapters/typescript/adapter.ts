import { createRequire } from 'node:module'
import { extname, posix } from 'node:path'
import type { Node } from 'web-tree-sitter'
import type { SymbolKind } from '../../../world/facts.ts'
import type { LanguageAdapter } from '../../language-adapter.ts'
import { resolveLspMemoryBudget } from '../../lsp.ts'

// TypeScript and JavaScript: tree-sitter-typescript for the parser side,
// typescript-language-server for the semantic side.

const require = createRequire(import.meta.url)

const SYMBOLS = `
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (type_identifier) @name) @definition.class
(abstract_class_declaration name: (type_identifier) @name) @definition.class
(method_definition name: [(property_identifier) (private_property_identifier)] @name) @definition.method
(abstract_method_signature name: (property_identifier) @name) @definition.method
(interface_declaration name: (type_identifier) @name) @definition.interface
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum
(internal_module name: (identifier) @name) @definition.namespace
(variable_declarator name: (identifier) @name) @definition.variable
`

const IMPORTS = `
(import_statement source: (string) @import.source) @import
(import_statement (import_clause (identifier) @import.name)) @import
(import_statement (import_clause (named_imports (import_specifier alias: (identifier) @import.name)))) @import
(import_statement (import_clause (named_imports (import_specifier !alias name: (identifier) @import.name)))) @import
(import_statement (import_clause (namespace_import (identifier) @import.name))) @import
(export_statement source: (string) @import.source) @import
(call_expression function: (import) arguments: (arguments . (string) @import.source)) @import
((call_expression
  function: (identifier) @_require
  arguments: (arguments . (string) @import.source)) @import
  (#eq? @_require "require"))
`

const CALLS = `
(call_expression function: (identifier) @call.name) @call
(call_expression function: (member_expression property: (property_identifier) @call.name) @call.member) @call
(new_expression constructor: (identifier) @call.name) @call
`

const BRANCHES = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'switch_case',
  'catch_clause',
  'ternary_expression',
])
const LOGICAL = new Set(['&&', '||', '??'])

const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'generator_function'])
const TOP_LEVEL = new Set(['program', 'export_statement'])

// Order matters: a specifier ending in .js may name a .ts source.
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs']
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
}

function symbolKind(suffix: string, node: Node): SymbolKind | undefined {
  if (suffix !== 'variable') return suffix as SymbolKind
  // A const holding a function is a function; other variables count only at
  // file top level, so locals do not crowd the map.
  const value = node.childForFieldName('value')
  if (value && FUNCTION_VALUES.has(value.type)) return 'function'
  return TOP_LEVEL.has(node.parent?.parent?.type ?? '') ? 'variable' : undefined
}

function isExported(declaration: Node): boolean {
  const holder = declaration.type === 'variable_declarator' ? declaration.parent : declaration
  return holder?.parent?.type === 'export_statement'
}

export function resolveImport(
  specifier: string,
  fromPath: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return undefined
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier))
  const candidates = [base]
  const ext = extname(base)
  for (const swap of JS_TO_TS[ext] ?? []) candidates.push(base.slice(0, -ext.length) + swap)
  for (const source of SOURCE_EXTENSIONS) candidates.push(base + source)
  for (const source of SOURCE_EXTENSIONS) candidates.push(`${base}/index${source}`)
  return candidates.find((candidate) => files.has(candidate))
}

export const typescriptAdapter: LanguageAdapter = {
  id: 'typescript',
  version: 1,
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  grammar(path) {
    // The TypeScript grammar rejects JSX, and the TSX grammar rejects <T>x
    // casts, so plain TypeScript keeps its own grammar.
    const ext = extname(path)
    const name = ext === '.ts' || ext === '.mts' || ext === '.cts' ? 'typescript' : 'tsx'
    return require.resolve(`tree-sitter-typescript/tree-sitter-${name}.wasm`)
  },
  queries: { symbols: SYMBOLS, imports: IMPORTS, calls: CALLS },
  isBranch(type, node) {
    if (BRANCHES.has(type)) return true
    if (type !== 'binary_expression') return false
    return LOGICAL.has(node().childForFieldName('operator')?.type ?? '')
  },
  symbolKind,
  isExported,
  isTypeOnlyImport(statement) {
    return statement.children.some((child) => child?.type === 'type')
  },
  resolveImport,
  languageServer: {
    command: () => [
      process.execPath,
      require.resolve('typescript-language-server/lib/cli.mjs'),
      '--stdio',
    ],
    languageId(path) {
      const ext = extname(path)
      if (ext === '.tsx') return 'typescriptreact'
      if (ext === '.jsx') return 'javascriptreact'
      if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'javascript'
      return 'typescript'
    },
    initializationOptions: () => ({
      tsserver: { path: require.resolve('typescript/lib/tsserver.js') },
      maxTsServerMemory: resolveLspMemoryBudget().serverMemoryMb,
      preferences: { includeCompletionsForModuleExports: false },
    }),
  },
}
