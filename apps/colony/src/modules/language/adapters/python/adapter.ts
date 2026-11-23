import { createRequire } from 'node:module'
import { posix } from 'node:path'
import type { Node } from 'web-tree-sitter'
import type { SymbolKind } from '../../../world/facts.ts'
import type { LanguageAdapter } from '../../language-adapter.ts'

// Python: tree-sitter-python for the parser side. No language server yet.

const require = createRequire(import.meta.url)

const SYMBOLS = `
(class_definition name: (identifier) @name) @definition.class
(function_definition name: (identifier) @name) @definition.function
`

// Each imported name is its own import, so `from pkg import a, b` can point
// at pkg/a.py and pkg/b.py.
const IMPORTS = `
(import_statement name: (dotted_name) @import.source @import)
(import_statement name: (aliased_import name: (dotted_name) @import.source alias: (identifier) @import.name) @import)
(import_from_statement module_name: (_) @import.source name: (dotted_name) @import.member @import.name @import)
(import_from_statement module_name: (_) @import.source name: (aliased_import name: (dotted_name) @import.member alias: (identifier) @import.name) @import)
(import_from_statement module_name: (_) @import.source (wildcard_import) @import)
`

const CALLS = `
(call function: (identifier) @call.name) @call
(call function: (attribute attribute: (identifier) @call.name) @call.member) @call
`

const BRANCHES = new Set([
  'if_statement',
  'elif_clause',
  'for_statement',
  'while_statement',
  'except_clause',
  'case_clause',
  'conditional_expression',
  'boolean_operator',
  'for_in_clause',
  'if_clause',
])

// Files that make their folder a project root that absolute imports start from.
const PROJECT_FILES = new Set([
  'pyproject.toml',
  'setup.cfg',
  'setup.py',
  'requirements.txt',
  'Pipfile',
])

// The nearest enclosing function or class of a definition.
function ownerOf(node: Node): Node | undefined {
  for (let up = node.parent; up; up = up.parent) {
    if (up.type === 'function_definition' || up.type === 'class_definition') return up
  }
  return undefined
}

// Definitions inside a function are locals and stay off the map; a function
// in a class is a method.
function symbolKind(suffix: string, node: Node): SymbolKind | undefined {
  for (let owner = ownerOf(node); owner; owner = ownerOf(owner)) {
    if (owner.type === 'function_definition') return undefined
  }
  if (suffix === 'function' && ownerOf(node)?.type === 'class_definition') return 'method'
  return suffix as SymbolKind
}

// Python has no export keyword: module-level names without a leading
// underscore are public.
function isExported(declaration: Node): boolean {
  const name = declaration.childForFieldName('name')?.text ?? ''
  return ownerOf(declaration) === undefined && !name.startsWith('_')
}

interface SourceRoots {
  // Folders absolute imports start from, deepest first.
  roots: string[]
  // Folders holding an __init__.py.
  packages: Set<string>
}

const rootsByFiles = new WeakMap<ReadonlySet<string>, SourceRoots>()

// The repository root, every folder holding a pyproject.toml, setup.cfg,
// setup.py, requirements.txt or Pipfile, and the src/ folder of each of those
// (src layout).
function getSourceRoots(files: ReadonlySet<string>): SourceRoots {
  const cached = rootsByFiles.get(files)
  if (cached) return cached
  const projects = new Set(['.'])
  const dirs = new Set<string>()
  const packages = new Set<string>()
  for (const path of files) {
    const dir = posix.dirname(path)
    const name = posix.basename(path)
    if (PROJECT_FILES.has(name)) projects.add(dir)
    if (name === '__init__.py') packages.add(dir)
    if (path.endsWith('.py')) dirs.add(dir)
  }
  const roots = new Set(projects)
  for (const project of projects) {
    const src = posix.join(project, 'src')
    if ([...dirs].some((dir) => dir === src || dir.startsWith(`${src}/`))) roots.add(src)
  }
  const depth = (dir: string) => (dir === '.' ? 0 : dir.split('/').length)
  const result = { roots: [...roots].sort((a, b) => depth(b) - depth(a)), packages }
  rootsByFiles.set(files, result)
  return result
}

// The module file for a dotted name under a folder: the longest prefix that is
// a module or a package, since `from pkg.mod import name` may name a function
// rather than a submodule. With allowPackage, the folder's own __init__.py
// answers when nothing below it does.
function findModule(
  dir: string,
  segments: string[],
  files: ReadonlySet<string>,
  allowPackage: boolean,
): string | undefined {
  for (let take = segments.length; take >= (allowPackage ? 0 : 1); take--) {
    const base = posix.join(dir, ...segments.slice(0, take))
    if (take > 0 && files.has(`${base}.py`)) return `${base}.py`
    if (files.has(posix.join(base, '__init__.py'))) return posix.join(base, '__init__.py')
  }
  return undefined
}

export function resolveImport(
  specifier: string,
  fromPath: string,
  files: ReadonlySet<string>,
): string | undefined {
  const dots = /^\.*/.exec(specifier)?.[0].length ?? 0
  const segments = specifier.slice(dots).split('.').filter(Boolean)
  const here = posix.dirname(fromPath)

  if (dots > 0) {
    let dir = here
    for (let up = 1; up < dots; up++) {
      if (dir === '.') return undefined
      dir = posix.dirname(dir)
    }
    return findModule(dir, segments, files, true)
  }

  const { roots, packages } = getSourceRoots(files)
  const inside = (root: string) => root === '.' || here === root || here.startsWith(`${root}/`)
  const ordered = [...roots.filter(inside), ...roots.filter((root) => !inside(root))]
  // Last, the folder above the importing file's top-most package, or its own
  // folder outside any package, as Python and pytest put that folder on
  // sys.path. Never a folder inside a package, which would let a local
  // email.py shadow the standard library, as Python 3 never does.
  let top = here
  while (top !== '.' && packages.has(top)) top = posix.dirname(top)
  if (!ordered.includes(top)) ordered.push(top)
  for (const root of ordered) {
    const found = findModule(root, segments, files, false)
    if (found) return found
  }
  return undefined
}

export const pythonAdapter: LanguageAdapter = {
  id: 'python',
  version: 1,
  extensions: ['.py'],
  grammar: () => require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
  queries: { symbols: SYMBOLS, imports: IMPORTS, calls: CALLS },
  isBranch: (type) => BRANCHES.has(type),
  symbolKind,
  isExported,
  importSpecifier: (source, member) =>
    source.endsWith('.') ? `${source}${member}` : `${source}.${member}`,
  resolveImport,
}
