// A firstmate worker's status file (state/<id>.status): one event per line,
//
//   <verb> [key=<slug>] [at=<epoch>]: <text>
//
// appended by the worker and firstmate. A needs-decision or blocked event
// stays open until a `resolved` line with the same key lands (an unkeyed one
// until an unkeyed `resolved`); a later working or done line does not close
// it. Lines with other verbs (acked, note, progress, ...) are annotations.

export const WORKER_STATES = ['working', 'waiting', 'blocked', 'pr-ready'] as const
export type WorkerState = (typeof WORKER_STATES)[number]

export interface WorkerStatus {
  state: WorkerState
  // The text of the event that decides the state.
  note?: string
  // The newest pull request link in any line.
  pullRequestUrl?: string
}

interface StatusEvent {
  verb: string
  key?: string
  text: string
}

const LINE = /^([a-z][\w-]*)((?:\s*\[[^\]]*\])*)\s*:\s?(.*)$/
const KEY = /\[key=([^\]]+)\]/
const PULL_REQUEST_URL = /https?:\/\/\S+?\/(?:pull|pulls|merge_requests)\/\d+/g
const PROGRESS_VERBS = new Set(['working', 'paused', 'done', 'failed'])
const OPENING_VERBS = new Set(['needs-decision', 'blocked'])

export function parseStatusLog(text: string): WorkerStatus {
  const open = new Map<string, StatusEvent>()
  let last: StatusEvent | undefined
  let pullRequestUrl: string | undefined
  for (const line of text.split('\n')) {
    const event = parseStatusLine(line.trim())
    if (!event) continue
    pullRequestUrl = [...event.text.matchAll(PULL_REQUEST_URL)].at(-1)?.[0] ?? pullRequestUrl
    const key = event.key ?? ''
    if (event.verb === 'resolved') open.delete(key)
    if (OPENING_VERBS.has(event.verb)) {
      // Re-opening a key moves it to the end, so the newest open event wins.
      open.delete(key)
      open.set(key, event)
    }
    if (PROGRESS_VERBS.has(event.verb)) last = event
  }
  const pending = [...open.values()]
  const waiting = pending.findLast((event) => event.verb === 'needs-decision')
  const blocked = pending.findLast((event) => event.verb === 'blocked')
  const deciding = waiting ?? blocked ?? last
  const status: WorkerStatus = { state: stateOf(deciding) }
  if (deciding?.text) status.note = deciding.text
  if (pullRequestUrl) status.pullRequestUrl = pullRequestUrl
  return status
}

export function parseStatusLine(line: string): StatusEvent | undefined {
  const match = LINE.exec(line)
  if (!match?.[1]) return undefined
  const key = KEY.exec(match[2] ?? '')?.[1]
  return { verb: match[1], text: (match[3] ?? '').trim(), ...(key ? { key } : {}) }
}

function stateOf(event: StatusEvent | undefined): WorkerState {
  switch (event?.verb) {
    case 'needs-decision':
      return 'waiting'
    case 'blocked':
    case 'failed':
      return 'blocked'
    case 'done':
      // A done that names its PR hands it over for review; the first done of
      // a ship worker only starts the pipeline, which is still at work.
      return event.text.match(PULL_REQUEST_URL) ? 'pr-ready' : 'working'
    default:
      return 'working'
  }
}
