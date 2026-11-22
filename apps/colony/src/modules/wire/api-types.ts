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

// GET /api/colonists: the coding sessions at work in copies of the mapped
// repositories. A colonist is one copy (a clone or worktree) whose files
// differ from its main branch; sub-agents share their parent's copy, so they
// never add one.

// working, paused: a session is on it. waiting: it needs you. blocked, error:
// it stopped. pr-ready: its pull request is open. idle: changes, but no live
// session in the copy and no task saying how it ended.
export const COLONIST_STATUSES = [
  'working',
  'paused',
  'waiting',
  'blocked',
  'error',
  'pr-ready',
  'idle',
] as const
export type ColonistStatus = (typeof COLONIST_STATUSES)[number]

export const CHANGE_KINDS = ['modified', 'added', 'removed'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

// firstmate: a worker firstmate launched. own: any other session, such as
// your own Claude Code. none: no live session.
export type SessionKind = 'firstmate' | 'own' | 'none'

// A file in a colonist's diff, by repository-relative path.
export interface ColonistChange {
  path: string
  kind: ChangeKind
  // Added files: the side of the square the file will take on the map, in
  // grid units, from its line count.
  units: number
}

export interface Colonist {
  // The copy's absolute path; stable while the copy exists.
  id: string
  // The node id of the mapped repository the copy belongs to.
  repoId: string
  label: string
  status: ColonistStatus
  // The text of the status line that decides its status, when it has one.
  note?: string
  // The firstmate task working in the copy.
  task?: string
  session: SessionKind
  // The agent kind, such as `claude` or `codex`, when known.
  agent?: string
  // The copy's path, with the home folder shortened to `~`.
  copy: string
  // The checked-out branch, or undefined when detached.
  branch?: string
  head: string
  // The branch the diff is taken against, such as `production`.
  base: string
  pr?: string
  // The Herdr pane the session runs in, to focus it in the terminal.
  paneId?: string
  changes: ColonistChange[]
  // Changes left out past the cap.
  omitted: number
  // The changed file it saved last: the one with the newest modification
  // time in its copy. Where its robot stands on the map.
  lastSaved?: string
}

export interface ColonistsResponse {
  version: number
  colonists: Colonist[]
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
