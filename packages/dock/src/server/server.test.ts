import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  encodeResize,
  FOCUS_PATH,
  PTY_PATH,
  SUBPROTOCOL,
  WORKERS_PATH,
} from '../shared/protocol.ts'
import type { DockOptions } from './options.ts'
import { createDock, type Dock, securityHeaders } from './server.ts'
import { AGENTS, type FakeHerdr, ok, startFakeHerdr } from './testing/fake-herdr.ts'

const TOKEN = 'test-token'

// Sends a raw request so the Host header can be set freely.
function send(
  port: number,
  path: string,
  {
    method = 'GET',
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let text = ''
        res.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8')
        })
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }),
        )
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('dock server', () => {
  let fake: FakeHerdr
  let dock: Dock
  let server: Server
  let port: number
  const auth = { authorization: `Bearer ${TOKEN}` }

  beforeAll(async () => {
    fake = await startFakeHerdr((req) => {
      if (req.method === 'agent.list') return ok(req, { type: 'agent_list', agents: AGENTS })
      if (req.method === 'pane.focus') return ok(req, { type: 'ok' })
      return null
    })
    const options: DockOptions = {
      session: 'fm-lab-test',
      socketPath: fake.socketPath,
      client: { file: 'herdr', args: [] },
      cwd: '/',
      lab: true,
    }
    dock = createDock(options, {
      token: TOKEN,
      command: { file: '/bin/cat', args: [], cwd: '/', env: { PATH: '/usr/bin:/bin' } },
    })
    const headers = securityHeaders()
    server = createServer((req, res) => {
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
      if (!dock.handle(req, res)) res.writeHead(418).end()
    })
    server.on('upgrade', (req, socket, head) => {
      if (!dock.upgrade(req, socket, head)) socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    dock.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fake.close()
  })

  describe('http', () => {
    it('lists workers with the token', async () => {
      const response = await send(port, WORKERS_PATH, { headers: auth })
      expect(response.status).toBe(200)
      const { workers } = JSON.parse(response.body) as { workers: { paneId: string }[] }
      expect(workers.map((worker) => worker.paneId)).toEqual(['w1:p1', 'w2:p4'])
      expect(response.body).not.toContain('/private/path')
    })

    it('sets the security headers', async () => {
      const response = await send(port, WORKERS_PATH, { headers: auth })
      expect(response.headers['content-security-policy']).toContain("default-src 'self'")
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['referrer-policy']).toBe('no-referrer')
      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('rejects a missing or wrong token', async () => {
      expect((await send(port, WORKERS_PATH, {})).status).toBe(401)
      expect(
        (await send(port, WORKERS_PATH, { headers: { authorization: 'Bearer nope' } })).status,
      ).toBe(401)
    })

    it('rejects a foreign Host', async () => {
      const response = await send(port, WORKERS_PATH, {
        headers: { ...auth, host: `evil.example:${port}` },
      })
      expect(response.status).toBe(403)
    })

    it('rejects a foreign Origin', async () => {
      const response = await send(port, WORKERS_PATH, {
        headers: { ...auth, origin: 'http://evil.example' },
      })
      expect(response.status).toBe(403)
    })

    it('focuses a pane', async () => {
      const response = await send(port, FOCUS_PATH, {
        method: 'POST',
        headers: {
          ...auth,
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${port}`,
        },
        body: JSON.stringify({ paneId: 'w2:p4' }),
      })
      expect(response.status).toBe(204)
      expect(fake.requests.at(-1)).toMatchObject({
        method: 'pane.focus',
        params: { pane_id: 'w2:p4' },
      })
    })

    it.each([
      ['a bad pane id', 'application/json', '{"paneId":"w1 p1"}', 400],
      ['malformed JSON', 'application/json', '{', 400],
      ['null', 'application/json', 'null', 400],
      ['a form post', 'text/plain', '{"paneId":"w1:p1"}', 415],
    ])('rejects focus with %s', async (_, type, body, status) => {
      const response = await send(port, FOCUS_PATH, {
        method: 'POST',
        headers: { ...auth, 'content-type': type },
        body,
      })
      expect(response.status).toBe(status)
    })

    it('answers unknown dock routes with 404 and leaves the rest to the app', async () => {
      expect((await send(port, '/api/dock/nope', { headers: auth })).status).toBe(404)
      expect((await send(port, '/', {})).status).toBe(418)
    })
  })

  describe('terminal', () => {
    function open(
      protocols: string[],
      headers: Record<string, string> = { origin: `http://127.0.0.1:${port}` },
    ): WebSocket {
      return new WebSocket(`ws://127.0.0.1:${port}${PTY_PATH}`, protocols, { headers })
    }

    function rejected(ws: WebSocket): Promise<number> {
      return new Promise((resolve) => {
        ws.on('unexpected-response', (_, res) => resolve(res.statusCode ?? 0))
        ws.on('error', () => resolve(-1))
      })
    }

    it('echoes keystrokes through the pty', async () => {
      const ws = open([SUBPROTOCOL, `token.${TOKEN}`])
      await new Promise((resolve) => ws.on('open', resolve))
      expect(ws.protocol).toBe(SUBPROTOCOL)
      ws.send(encodeResize(100, 30))
      const output = new Promise<string>((resolve) => {
        let seen = ''
        ws.on('message', (data: Buffer) => {
          seen += data.toString('utf8')
          if (seen.includes('hello-dock')) resolve(seen)
        })
      })
      ws.send(Buffer.from('hello-dock\r'))
      expect(await output).toContain('hello-dock')
      ws.close()
    })

    it('rejects a missing token', async () => {
      expect(await rejected(open([SUBPROTOCOL]))).toBe(401)
    })

    it('rejects a wrong token', async () => {
      expect(await rejected(open([SUBPROTOCOL, 'token.nope']))).toBe(401)
    })

    it('rejects a foreign Origin', async () => {
      const ws = open([SUBPROTOCOL, `token.${TOKEN}`], { origin: 'http://evil.example' })
      expect(await rejected(ws)).toBe(403)
    })

    it('rejects a missing Origin', async () => {
      expect(await rejected(open([SUBPROTOCOL, `token.${TOKEN}`], {}))).toBe(403)
    })

    it('rejects a foreign Host', async () => {
      const ws = open([SUBPROTOCOL, `token.${TOKEN}`], {
        origin: `http://127.0.0.1:${port}`,
        host: `evil.example:${port}`,
      })
      expect(await rejected(ws)).toBe(403)
    })

    it('rejects a client without the dock subprotocol', async () => {
      const ws = open([`token.${TOKEN}`])
      expect(await rejected(ws)).toBe(400)
    })
  })
})

describe('dock server without herdr', () => {
  it('tells the page when the client cannot start', async () => {
    const dock = createDock(
      {
        session: null,
        socketPath: '/nonexistent/herdr.sock',
        client: { file: 'herdr', args: [] },
        cwd: '/',
        lab: false,
      },
      { token: TOKEN, command: { file: '/nonexistent/herdr', args: [], cwd: '/', env: {} } },
    )
    const server = createServer((req, res) => {
      if (!dock.handle(req, res)) res.writeHead(418).end()
    })
    server.on('upgrade', (req, socket, head) => {
      if (!dock.upgrade(req, socket, head)) socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}${PTY_PATH}`,
        [SUBPROTOCOL, `token.${TOKEN}`],
        {
          headers: { origin: `http://127.0.0.1:${port}` },
        },
      )
      const output = await new Promise<string>((resolve) => {
        let seen = ''
        ws.on('message', (data: Buffer) => {
          seen += data.toString('utf8')
        })
        ws.on('close', () => resolve(seen))
      })
      expect(output).toMatch(/could not start|exited with code/)
      const workers = await send(port, WORKERS_PATH, {
        headers: { authorization: `Bearer ${TOKEN}` },
      })
      expect(workers.status).toBe(502)
      expect(JSON.parse(workers.body)).toMatchObject({
        error: expect.stringContaining('herdr.sock'),
      })
    } finally {
      dock.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
