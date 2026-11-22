import type { ColonistStatus, SessionKind } from '../wire/api-types.ts'
import type { FirstmateTask } from './firstmate-tasks.ts'
import type { LiveSession } from './session-source.ts'

// Who is at work in a copy and how it is going, from whatever the optional
// sources know: firstmate's status lines are the richest, Herdr's agent
// status says when a session is waiting on you, and a bare process says only
// that a session is there.

export interface ColonistPresence {
  status: ColonistStatus
  session: SessionKind
  note?: string
  pr?: string
  agent?: string
  paneId?: string
}

// The colonist status a firstmate status line stands for.
// TODO(#44): captain holds live in the firstmate backlog, not in status
// lines; once the build-queue module merges, map a held task to 'waiting'
// (waiting on you) through it.
export function statusFromTask(task: FirstmateTask): ColonistStatus | undefined {
  switch (task.status?.state) {
    case 'working':
    case 'progress':
    case 'resolved':
      return 'working'
    case 'paused':
      return 'paused'
    case 'needs-decision':
      return 'waiting'
    case 'blocked':
      return 'blocked'
    case 'failed':
      return 'error'
    case 'done':
      return task.pr ? 'pr-ready' : 'paused'
    default:
      return undefined
  }
}

// Statuses a firstmate task can end in, which hold with no live session.
const SETTLED: ReadonlySet<ColonistStatus> = new Set(['waiting', 'blocked', 'error', 'pr-ready'])

// sessions: the live sessions in the copy. canSeeSessions: some session
// source answered; when none did, a firstmate task alone counts as live.
// With no live session the copy is idle unless its task ended settled.
export function resolvePresence(
  task: FirstmateTask | undefined,
  sessions: readonly LiveSession[],
  canSeeSessions: boolean,
): ColonistPresence {
  const isLive = sessions.length > 0 || (task !== undefined && !canSeeSessions)
  const presence: ColonistPresence = { status: 'idle', session: 'none' }
  if (task?.status?.text) presence.note = task.status.text
  if (task?.pr) presence.pr = task.pr
  const agent = sessions.find((session) => session.agent)?.agent
  if (agent) presence.agent = agent
  if (!isLive) {
    const settled = task && statusFromTask(task)
    if (settled && SETTLED.has(settled)) presence.status = settled
    return presence
  }
  const paneId = sessions.find((session) => session.paneId)?.paneId
  if (paneId) presence.paneId = paneId
  presence.session = task ? 'firstmate' : 'own'
  const live = sessions.find((session) => session.status)?.status
  let status = (task && statusFromTask(task)) ?? live ?? 'working'
  // Herdr sees a prompt waiting for an answer before any status line does.
  if (live === 'waiting' && (status === 'working' || status === 'paused')) status = 'waiting'
  presence.status = status
  return presence
}

// A copy's name when no task names it: its folder and branch, such as
// `p/codecolony · production`, or `codecolony-d64159/5 · detached` for a
// numbered pool slot.
export function copyLabel(path: string, branch: string | undefined): string {
  const parts = path.split('/').filter(Boolean)
  const folder = parts.at(-1) ?? path
  const parent = parts.at(-2)
  const grandparent = parts.at(-3)
  const place =
    parent && /^\d+$/.test(parent) && grandparent
      ? `${grandparent}/${parent}`
      : parent
        ? `${parent}/${folder}`
        : folder
  return `${place} · ${branch ?? 'detached'}`
}

// The path with the home folder shortened to `~`.
export function tildify(path: string, home: string): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`
  return path
}
