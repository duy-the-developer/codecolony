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
  SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
  WORKERS_PATH,
  type WorkersResponse,
} from '../shared/protocol.ts'
import { keySequence } from './keys.ts'

export type { DockWorker, WorkerStatus } from '../shared/protocol.ts'

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

export function mountDock(el: HTMLElement, { token, pollMs = 3000 }: DockMountOptions): DockHandle {
  el.classList.add('cc-dock')
  const bar = document.createElement('div')
  bar.className = 'cc-dock-bar'
  const workerList = document.createElement('ul')
  workerList.className = 'cc-dock-workers'
  workerList.setAttribute('aria-label', 'Workers')
  const state = document.createElement('span')
  state.className = 'cc-dock-state'
  const reconnect = document.createElement('button')
  reconnect.type = 'button'
  reconnect.textContent = 'Reconnect'
  reconnect.hidden = true
  bar.append(workerList, state, reconnect)
  const screen = document.createElement('div')
  screen.className = 'cc-dock-screen'
  el.replaceChildren(bar, screen)

  const listeners = new Set<(workers: DockWorker[]) => void>()
  let current: DockWorker[] | null = null
  let shownKey = ''
  let disposed = false

  // Opening a token URL in a tab already on this page only changes the hash,
  // which reloads nothing; a server restart prints a new token, so take it.
  const onHash = () => {
    const next = readToken()
    if (next && next !== token) location.reload()
  }
  window.addEventListener('hashchange', onHash)

  if (!token) {
    state.textContent = 'No token: open the URL the server printed, with #token=...'
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
    state.textContent = 'Connecting...'
    sentSize = ''
    term.reset()
    const socket = new WebSocket(`ws://${location.host}${PTY_PATH}`, [
      SUBPROTOCOL,
      `${TOKEN_PROTOCOL_PREFIX}${token}`,
    ])
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => {
      state.textContent = ''
      sendSize()
      term.focus()
    }
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      term.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data))
    }
    socket.onclose = () => {
      if (ws !== socket || disposed) return
      ws = null
      state.textContent = 'Disconnected'
      reconnect.hidden = false
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

  function renderWorkers(workers: DockWorker[]): void {
    workerList.replaceChildren(
      ...workers.map((worker) => {
        const item = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `cc-dock-worker cc-status-${worker.status}`
        button.setAttribute('aria-pressed', String(worker.focused))
        button.title = `${worker.agent ?? 'agent'} in pane ${worker.paneId} (${worker.status})`
        button.textContent = worker.name ?? worker.agent ?? worker.paneId
        button.addEventListener('click', () => {
          focusPane(worker.paneId).catch(showError)
        })
        item.append(button)
        return item
      }),
    )
  }

  function showError(error: unknown): void {
    state.textContent = error instanceof Error ? error.message : String(error)
  }

  async function refresh(): Promise<void> {
    try {
      const workers = await listWorkers()
      if (disposed) return
      // Rebuilding the buttons on every poll would drop a click that lands mid-rebuild.
      const key = JSON.stringify(workers)
      if (key === shownKey) return
      shownKey = key
      current = workers
      renderWorkers(workers)
      for (const listener of listeners) listener(workers)
    } catch (error) {
      if (disposed) return
      shownKey = ''
      if (current?.length) {
        current = []
        for (const listener of listeners) listener(current)
      }
      const item = document.createElement('li')
      item.className = 'cc-dock-note'
      item.textContent = `Workers unavailable: ${error instanceof Error ? error.message : error}`
      workerList.replaceChildren(item)
    }
  }

  connect()
  void refresh()
  const poll = window.setInterval(() => void refresh(), pollMs)

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
