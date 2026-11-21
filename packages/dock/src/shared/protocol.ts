// Wire protocol between the dock in the page and the dock on the server.
//
// WebSocket PTY_PATH: binary frames carry terminal bytes in both directions;
// text frames from the page carry JSON control messages. The page offers two
// subprotocols: SUBPROTOCOL, which the server echoes back, and
// `token.<session token>`, which authenticates the upgrade without putting the
// token in a URL.
//
// HTTP: GET STATUS_PATH says whether Herdr is enabled, GET WORKERS_PATH lists
// the Herdr agents, POST FOCUS_PATH with {paneId} focuses one. All need
// `Authorization: Bearer <token>`. With Herdr disabled, the terminal upgrade
// and the Herdr routes answer 503.

export const SUBPROTOCOL = 'codecolony-dock.v1'
export const TOKEN_PROTOCOL_PREFIX = 'token.'
export const PTY_PATH = '/dock/pty'
export const STATUS_PATH = '/api/dock/status'
export const WORKERS_PATH = '/api/dock/workers'
export const FOCUS_PATH = '/api/dock/focus'

// Terminal sizes outside this range are rejected as malformed.
export const MAX_TERMINAL_CELLS = 1000

export interface ResizeMessage {
  type: 'resize'
  cols: number
  rows: number
}
export type ControlMessage = ResizeMessage

export function isValidTerminalSize(cols: number, rows: number): boolean {
  return [cols, rows].every((n) => Number.isInteger(n) && n > 0 && n <= MAX_TERMINAL_CELLS)
}

// Parses a text frame from the page; anything unexpected yields null.
export function parseControlMessage(raw: string): ControlMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { type, cols, rows } = value as Record<string, unknown>
  if (
    type === 'resize' &&
    typeof cols === 'number' &&
    typeof rows === 'number' &&
    isValidTerminalSize(cols, rows)
  ) {
    return { type, cols, rows }
  }
  return null
}

export function encodeResize(cols: number, rows: number): string {
  const message: ResizeMessage = { type: 'resize', cols, rows }
  return JSON.stringify(message)
}

// Herdr pane ids look like `w1:p2`; anything else never reaches the socket.
const PANE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/

export function isValidPaneId(value: unknown): value is string {
  return typeof value === 'string' && PANE_ID_PATTERN.test(value)
}

export const WORKER_STATUSES = ['idle', 'working', 'blocked', 'done', 'unknown'] as const
export type WorkerStatus = (typeof WORKER_STATUSES)[number]

// A worker as the map sees it: one Herdr pane running a coding agent.
export interface DockWorker {
  paneId: string
  workspaceId: string
  // The agent kind Herdr detected, such as `claude` or `codex`.
  agent: string | null
  // The name the agent was started or renamed with.
  name: string | null
  // What the page shows: the Herdr workspace label (the task name), else the
  // tab label, else the agent name or kind.
  label: string
  status: WorkerStatus
  focused: boolean
}

export interface StatusResponse {
  herdr: 'enabled' | 'disabled'
}

export interface WorkersResponse {
  workers: DockWorker[]
}

export interface FocusRequest {
  paneId: string
}

export interface ErrorResponse {
  error: string
}
