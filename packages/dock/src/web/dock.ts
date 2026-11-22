import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import './dock.css'
import {
  type DockWorker,
  encodeResize,
  FOCUS_PATH,
  type FocusRequest,
  PTY_PATH,
  STATUS_PATH,
  type StatusResponse,
  SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
  WORKERS_PATH,
  type WorkersResponse,
} from '../protocol/protocol.ts'
import { keySequence } from './keys.ts'

export type { DockWorker, WorkerStatus } from '../protocol/protocol.ts'

export interface DockHandle {
  // Asks Herdr to focus a pane; the terminal then shows it.
  focusPane(paneId: string): Promise<void>
  listWorkers(): Promise<DockWorker[]>
  // Called with the current worker list, then whenever it changes; returns an
  // unsubscribe.
  onWorkers(listener: (workers: DockWorker[]) => void): () => void
  dispose(): void
}

export interface DockMountOptions {
  token: string | null
  // How often the worker list refreshes.
  pollMs?: number
}

const TOKEN_KEY = 'codecolony.dock.token'
const STALE_TOKEN = 'Token not accepted: the server restarted, open the URL it printed'
const HERDR_DISABLED =
  'Herdr is disabled for this run (--no-herdr, CODECOLONY_HERDR=off or CI), so the dock does not attach to any session.'

// Reads the token from `#token=...` once, keeps it for this tab in
// sessionStorage and strips it from the address bar.
export function readToken(): string | null {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token')
  if (fromHash) {
    sessionStorage.setItem(TOKEN_KEY, fromHash)
    history.replaceState(null, '', location.pathname + location.search)
    return fromHash
  }
  return sessionStorage.getItem(TOKEN_KEY)
}

// The Herdr client fills the element. Herdr's own sidebar lists and switches
// the workers; a bar above it shows only while there is something to say,
// such as connecting, a disconnect or an unreachable worker list.
export function mountDock(el: HTMLElement, { token, pollMs = 3000 }: DockMountOptions): DockHandle {
  el.classList.add('cc-dock')
  const bar = document.createElement('div')
  bar.className = 'cc-dock-bar'
  bar.hidden = true
  const state = document.createElement('span')
  state.className = 'cc-dock-state'
  const reconnect = document.createElement('button')
  reconnect.type = 'button'
  reconnect.textContent = 'Reconnect'
  reconnect.hidden = true
  bar.append(state, reconnect)
  const screen = document.createElement('div')
  screen.className = 'cc-dock-screen'
  el.replaceChildren(bar, screen)

  const listeners = new Set<(workers: DockWorker[]) => void>()
  let current: DockWorker[] | null = null
  let shownKey = ''
  let disposed = false
  // The state line and the worker list each report here; the list's message
  // shows only while the terminal itself has nothing to report.
  let terminalNote = ''
  let workersNote = ''

  function showNotes(): void {
    state.textContent = terminalNote || workersNote
    bar.hidden = state.textContent === '' && reconnect.hidden
  }
  function setTerminalNote(text: string): void {
    terminalNote = text
    showNotes()
  }
  function setWorkersNote(text: string): void {
    workersNote = text
    showNotes()
  }

  // Opening a token URL in a tab already on this page only changes the hash,
  // which reloads nothing; a server restart prints a new token, so take it.
  const onHash = () => {
    const next = readToken()
    if (next && next !== token) location.reload()
  }
  window.addEventListener('hashchange', onHash)

  if (!token) {
    setTerminalNote('No token: open the URL the server printed, with #token=...')
    return {
      focusPane: () => Promise.reject(new Error('dock has no token')),
      listWorkers: () => Promise.reject(new Error('dock has no token')),
      onWorkers: () => () => {},
      dispose: () => {
        window.removeEventListener('hashchange', onHash)
        el.replaceChildren()
      },
    }
  }

  const term = new Terminal({
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: 12,
    cursorBlink: true,
    scrollback: 0,
    theme: { background: '#08121c', foreground: '#dce7f2', cursor: '#ffb347' },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(screen)

  const encoder = new TextEncoder()
  let ws: WebSocket | null = null
  let sentSize = ''

  function sendSize(): void {
    if (ws?.readyState !== WebSocket.OPEN) return
    const size = `${term.cols}x${term.rows}`
    if (size === sentSize) return
    sentSize = size
    ws.send(encodeResize(term.cols, term.rows))
  }

  function connect(): void {
    reconnect.hidden = true
    setTerminalNote('Connecting...')
    sentSize = ''
    term.reset()
    const socket = new WebSocket(`ws://${location.host}${PTY_PATH}`, [
      SUBPROTOCOL,
      `${TOKEN_PROTOCOL_PREFIX}${token}`,
    ])
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => {
      setTerminalNote('')
      sendSize()
      term.focus()
    }
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      term.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data))
    }
    socket.onclose = () => {
      if (ws !== socket || disposed) return
      ws = null
      reconnect.hidden = false
      setTerminalNote('Disconnected')
    }
    ws = socket
  }

  const send = (data: string) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(encoder.encode(data))
  }
  term.attachCustomKeyEventHandler((event) => {
    const sequence = keySequence(event)
    if (sequence === null) return true
    // Swallow the keypress and keyup too, and keep the textarea from
    // inserting a line break of its own.
    event.preventDefault()
    if (event.type === 'keydown') send(sequence)
    return false
  })
  term.onData(send)
  term.onBinary((data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(Uint8Array.from(data, (char) => char.charCodeAt(0)))
    }
  })
  term.onResize(sendSize)
  reconnect.addEventListener('click', connect)

  const resizer = new ResizeObserver(() => {
    if (screen.clientWidth > 0 && screen.clientHeight > 0) fit.fit()
  })
  resizer.observe(screen)

  const headers = { authorization: `Bearer ${token}` }

  // Any failure counts as enabled: the terminal and the bar then show it.
  async function readStatus(): Promise<StatusResponse['herdr']> {
    try {
      const response = await fetch(STATUS_PATH, { headers, cache: 'no-store' })
      if (!response.ok) return 'enabled'
      return ((await response.json()) as StatusResponse).herdr
    } catch {
      return 'enabled'
    }
  }

  function showDisabled(): void {
    screen.hidden = true
    const note = document.createElement('p')
    note.className = 'cc-dock-off'
    note.textContent = HERDR_DISABLED
    el.append(note)
  }

  async function listWorkers(): Promise<DockWorker[]> {
    const response = await fetch(WORKERS_PATH, { headers, cache: 'no-store' })
    if (response.status === 401) throw new Error(STALE_TOKEN)
    const body = (await response.json()) as WorkersResponse | { error: string }
    if (!response.ok || !('workers' in body)) {
      throw new Error('error' in body ? body.error : `workers: HTTP ${response.status}`)
    }
    return body.workers
  }

  async function focusPane(paneId: string): Promise<void> {
    const request: FocusRequest = { paneId }
    const response = await fetch(FOCUS_PATH, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (response.status === 401) throw new Error(STALE_TOKEN)
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `focus: HTTP ${response.status}`)
    }
    term.focus()
    void refresh()
  }

  async function refresh(): Promise<void> {
    try {
      const workers = await listWorkers()
      if (disposed) return
      setWorkersNote('')
      // Listeners hear only about changes, not every poll.
      const key = JSON.stringify(workers)
      if (key === shownKey) return
      shownKey = key
      current = workers
      for (const listener of listeners) listener(workers)
    } catch (error) {
      if (disposed) return
      shownKey = ''
      if (current?.length) {
        current = []
        for (const listener of listeners) listener(current)
      }
      setWorkersNote(`Workers unavailable: ${error instanceof Error ? error.message : error}`)
    }
  }

  let poll = 0
  void readStatus().then((status) => {
    if (disposed) return
    if (status === 'disabled') {
      showDisabled()
      return
    }
    connect()
    void refresh()
    poll = window.setInterval(() => void refresh(), pollMs)
  })

  return {
    focusPane,
    listWorkers,
    onWorkers(listener) {
      listeners.add(listener)
      if (current) listener(current)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      window.removeEventListener('hashchange', onHash)
      window.clearInterval(poll)
      resizer.disconnect()
      ws?.close()
      term.dispose()
      el.replaceChildren()
      el.classList.remove('cc-dock')
    },
  }
}
