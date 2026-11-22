// The page's one connection to /api/events, shared by every listener:
// browsers allow few connections per host, and each stream holds one open
// for as long as the tab lives.

type ServerEvent = 'world' | 'colonists'

let source: EventSource | undefined
let listeners = 0

// Calls listener on each event of this type, including the one the server
// sends on connecting; returns the unsubscribe.
export function subscribeServerEvent(type: ServerEvent, listener: () => void): () => void {
  source ??= new EventSource('/api/events')
  const events = source
  listeners++
  events.addEventListener(type, listener)
  return () => {
    events.removeEventListener(type, listener)
    if (--listeners > 0) return
    events.close()
    if (source === events) source = undefined
  }
}
