import type { SymbolKind } from '../world/world-types.ts'

// Shapes shared by the server's /api routes and the page.

// repo: one git repository; repos: a folder whose children are repositories;
// monorepo: one repository with workspace packages.
export const PROJECT_KINDS = ['repo', 'repos', 'monorepo'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]

export interface ProjectSummary {
  name: string
  kind: ProjectKind
}

export interface ProjectsResponse {
  projects: ProjectSummary[]
}

// GET /api/file?id=<file id>: a file's text at the commit its repository was
// indexed at. Binary files come back without text.
export interface FileResponse {
  id: string
  path: string
  commit: string | undefined
  isBinary: boolean
  text: string
}

// GET /api/search?q=<text>&limit=<n>: files and symbols by name, best first.
export interface SearchEntry {
  id: string
  kind: 'file' | 'symbol'
  name: string
  // Repository-relative path of the file (for a symbol, the file it is in).
  path: string
  symbolKind?: SymbolKind
  // Symbols: first line of the definition. Files: line count.
  line?: number
  lines: number
}

export interface SearchMatches {
  symbols: SearchEntry[]
  files: SearchEntry[]
}
