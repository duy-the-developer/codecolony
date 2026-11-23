// The page's one connection to /api/events, shared by every listener:
// browsers allow few connections per host, and each stream holds one open
// for as long as the tab lives.
//
// A browser retries a dropped stream on its own, but may give up for good
// (readyState CLOSED), say when the server is down while it retries. The page
// then opens a new stream after a pause, so it never goes quiet for the rest
// of its life; connecting sends every event again, which reloads what the
// page missed meanwhile.

type ServerEvent = 'world' | 'colonists'

const REOPEN_MS = 2000

let source: EventSource | undefined
let reopenTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Map<ServerEvent, Set<() => void>>()

// Calls listener on each event of this type, including the one the server
// sends on connecting; returns the unsubscribe.
export function subscribeServerEvent(type: ServerEvent, listener: () => void): () => void {
  let ofType = listeners.get(type)
  if (!ofType) {
    ofType = new Set()
    listeners.set(type, ofType)
  }
  ofType.add(listener)
  if (source) source.addEventListener(type, listener)
  else if (reopenTimer === undefined) open()
  return () => {
    ofType.delete(listener)
    source?.removeEventListener(type, listener)
    if ([...listeners.values()].some((set) => set.size > 0)) return
    clearTimeout(reopenTimer)
    reopenTimer = undefined
    source?.close()
    source = undefined
  }
}

function open(): void {
  const events = new EventSource('/api/events')
  source = events
  for (const [type, ofType] of listeners) {
    for (const listener of ofType) events.addEventListener(type, listener)
  }
  events.addEventListener('error', () => {
    if (events.readyState !== EventSource.CLOSED || source !== events) return
    source = undefined
    reopenTimer = setTimeout(() => {
      reopenTimer = undefined
      open()
    }, REOPEN_MS)
  })
}
