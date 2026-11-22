// A live coding session somewhere on this machine, as one source sees it.
// Sources are optional and independent: Herdr knows its panes' folders and
// status, a process scan knows only the folders agents run in. Either, both
// or neither may answer.

export type SessionStatus = 'working' | 'waiting' | 'paused'

export interface LiveSession {
  // The folder the session runs in.
  cwd: string
  // The agent kind, such as `claude` or `codex`.
  agent?: string
  status?: SessionStatus
  // The Herdr pane it runs in.
  paneId?: string
}

export interface SessionSource {
  readonly name: string
  // Rejects when the source cannot be reached this time.
  listSessions(): Promise<LiveSession[]>
}

// The sessions whose folder is the copy or inside it.
export function isInside(cwd: string, copy: string): boolean {
  return cwd === copy || cwd.startsWith(copy.endsWith('/') ? copy : `${copy}/`)
}
