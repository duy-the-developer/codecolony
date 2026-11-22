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

// GET /api/build-queue: the configured firstmate home's orders for the
// projects on the map, read only. Without a firstmate home in the config the
// queue is not connected.
export const ORDER_SECTIONS = ['active', 'queued', 'done'] as const
export type OrderSection = (typeof ORDER_SECTIONS)[number]

// waiting: needs your decision. Active orders sort in this order.
export const ORDER_STATES = ['waiting', 'blocked', 'pr-ready', 'working', 'queued', 'done'] as const
export type OrderState = (typeof ORDER_STATES)[number]

export interface BuildOrder {
  // The firstmate task id.
  id: string
  title: string
  section: OrderSection
  state: OrderState
  // The project on the map the order belongs to (the backlog's repo).
  project: string
  // ship, scout, captain, task, ...
  kind?: string
  // The worker's task id while a worker runs it: the colonist.
  colonist?: string
  pullRequestUrl?: string
  // The worker's latest status line, or why a queued order waits.
  note?: string
  // Done orders: when they finished. Others: since when they are open.
  date?: string
  // A worker's copy exists, so its changes can be shown on the map.
  hasWorktree: boolean
}

export type BuildQueueResponse =
  | { isConnected: false }
  | { isConnected: true; orders: BuildOrder[] }

// GET /api/build-queue/changes?id=<task id>: the files the order's worker
// changed against its main branch, committed or not, repository-relative.
export interface OrderChangesResponse {
  project: string
  // The backlog's repository name: the repository inside the project.
  repo: string
  paths: string[]
}
