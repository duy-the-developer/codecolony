import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import {
  type ErrorResponse,
  FOCUS_PATH,
  isValidPaneId,
  PTY_PATH,
  STATUS_PATH,
  type StatusResponse,
  SUBPROTOCOL,
  WORKERS_PATH,
  type WorkersResponse,
} from '../protocol/protocol.ts'
import {
  createToken,
  isAllowedHost,
  isAllowedOrigin,
  tokenFromAuthorization,
  tokenFromProtocols,
  tokensMatch,
} from './auth.ts'
import { createHerdrApi, type HerdrApi } from './herdr-api.ts'
import { clientEnv, type DockOptions } from './options.ts'
import { bridgePty, type PtyCommand } from './pty-bridge.ts'

const MAX_PTYS = 4
const MAX_FRAME_BYTES = 1024 * 1024
const MAX_BODY_BYTES = 4096
const HERDR_DISABLED = 'Herdr is disabled'

export interface Dock {
  // Per-run secret the page must present; print it only in the URL fragment.
  token: string
  // Answers the dock's HTTP routes and returns true, or returns false.
  handle(req: IncomingMessage, res: ServerResponse): boolean
  // Takes WebSocket upgrades for the terminal and returns true, or returns false.
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean
  // Guards another HTTP route as the dock guards its own: Host, Origin and
  // bearer token. Returns the status to refuse the request with, or null.
  deny(req: IncomingMessage): 401 | 403 | null
  close(): void
}

export interface DockDeps {
  herdr?: HerdrApi
  // Replaces the Herdr client in the terminal, for tests.
  command?: PtyCommand
  token?: string
}

export function createDock(options: DockOptions, deps: DockDeps = {}): Dock {
  const token = deps.token ?? createToken()
  // Disabled, the dock holds no Herdr client at all, so nothing can reach the socket.
  const herdr = options.enabled ? (deps.herdr ?? createHerdrApi(options.socketPath)) : null
  const command: PtyCommand = deps.command ?? {
    ...options.client,
    cwd: options.cwd,
    env: clientEnv(process.env),
  }
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    handleProtocols: () => SUBPROTOCOL,
  })
  let ptys = 0

  // Host on every request; Origin whenever the browser sends one; the token always.
  function deny(req: IncomingMessage, bearer: string | undefined): 401 | 403 | null {
    const port = req.socket.localPort ?? 0
    if (!isAllowedHost(req.headers.host, port)) return 403
    const { origin } = req.headers
    if (origin !== undefined && !isAllowedOrigin(origin, port)) return 403
    if (!tokensMatch(token, bearer)) return 401
    return null
  }

  async function workers(res: ServerResponse): Promise<void> {
    if (!herdr) {
      json(res, 503, { error: HERDR_DISABLED })
      return
    }
    try {
      const body: WorkersResponse = { workers: await herdr.listWorkers() }
      json(res, 200, body)
    } catch (error) {
      json(res, 502, { error: (error as Error).message })
    }
  }

  async function focus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!herdr) {
      json(res, 503, { error: HERDR_DISABLED })
      return
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      json(res, 415, { error: 'expected application/json' })
      return
    }
    let paneId: unknown
    try {
      paneId = (JSON.parse(await readBody(req)) as { paneId?: unknown }).paneId
    } catch {
      json(res, 400, { error: 'expected {"paneId": "<pane id>"}' })
      return
    }
    if (!isValidPaneId(paneId)) {
      json(res, 400, { error: 'expected {"paneId": "<pane id>"}' })
      return
    }
    try {
      await herdr.focusPane(paneId)
      res.writeHead(204).end()
    } catch (error) {
      json(res, 502, { error: (error as Error).message })
    }
  }

  return {
    token,
    deny: (req) => deny(req, tokenFromAuthorization(req.headers.authorization)),
    handle(req, res) {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost')
      if (!pathname.startsWith('/api/dock/')) return false
      const denied = deny(req, tokenFromAuthorization(req.headers.authorization))
      if (denied) {
        json(res, denied, { error: denied === 401 ? 'missing or wrong token' : 'forbidden' })
      } else if (req.method === 'GET' && pathname === STATUS_PATH) {
        json(res, 200, { herdr: herdr ? 'enabled' : 'disabled' })
      } else if (req.method === 'GET' && pathname === WORKERS_PATH) {
        void workers(res)
      } else if (req.method === 'POST' && pathname === FOCUS_PATH) {
        void focus(req, res)
      } else {
        json(res, 404, { error: 'not found' })
      }
      return true
    },
    upgrade(req, socket, head) {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost')
      if (pathname !== PTY_PATH) return false
      const protocols = req.headers['sec-websocket-protocol']
      const port = req.socket.localPort ?? 0
      // Upgrades always carry an Origin from a browser; require it.
      const origin = req.headers.origin
      const denied =
        deny(req, tokenFromProtocols(protocols)) ??
        (origin === undefined || !isAllowedOrigin(origin, port) ? 403 : null)
      if (denied) return reject(socket, denied)
      const offered = protocols?.split(',').map((value) => value.trim()) ?? []
      if (!offered.includes(SUBPROTOCOL)) return reject(socket, 400)
      if (!herdr) return reject(socket, 503)
      if (ptys >= MAX_PTYS) return reject(socket, 503)
      wss.handleUpgrade(req, socket, head, (ws) => {
        ptys += 1
        bridgePty(ws, command, () => {
          ptys -= 1
        })
      })
      return true
    },
    close() {
      for (const client of wss.clients) client.terminate()
      wss.close()
    },
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  503: 'Service Unavailable',
}

function reject(socket: Duplex, status: number): true {
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\n\r\n`)
  return true
}

function json(
  res: ServerResponse,
  status: number,
  body: StatusResponse | WorkersResponse | ErrorResponse,
): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// Response headers for every page and API response of the app hosting the dock.
// xterm.js writes <style> elements, so styles allow 'unsafe-inline'. In dev,
// Vite's hot-reload socket runs on its own port.
export function securityHeaders({ dev = false }: { dev?: boolean } = {}): Record<string, string> {
  const connect = dev ? "'self' ws://127.0.0.1:* ws://localhost:*" : "'self'"
  return {
    'content-security-policy': [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      `connect-src ${connect}`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  }
}
