import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface FakeRequest {
  id: string
  method: string
  params: unknown
}

// Answers a request with a raw reply line (without the newline), or null to
// hang up without answering.
export type FakeHandler = (request: FakeRequest) => string | null

export interface FakeHerdr {
  socketPath: string
  requests: FakeRequest[]
  close(): Promise<void>
}

// A stand-in for the Herdr API socket: one JSON line in, one JSON line out,
// then the connection closes, as Herdr does.
export async function startFakeHerdr(handler: FakeHandler): Promise<FakeHerdr> {
  const socketPath = join(mkdtempSync(join(tmpdir(), 'cc-herdr-')), 'h.sock')
  const requests: FakeRequest[] = []
  const server: Server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const end = buffer.indexOf('\n')
      if (end === -1) return
      const request = JSON.parse(buffer.slice(0, end)) as FakeRequest
      requests.push(request)
      const reply = handler(request)
      if (reply === null) socket.end()
      else socket.end(`${reply}\n`)
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  return {
    socketPath,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

export function ok(request: FakeRequest, result: unknown): string {
  return JSON.stringify({ id: request.id, result })
}

export const FAKE_AGENTS = [
  {
    pane_id: 'w1:p1',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    terminal_id: 'term_1',
    agent: 'claude',
    name: 'dock',
    agent_status: 'working',
    focused: true,
    revision: 3,
    cwd: '/private/path',
  },
  {
    pane_id: 'w2:p4',
    workspace_id: 'w2',
    tab_id: 'w2:t1',
    terminal_id: 'term_2',
    agent: null,
    agent_status: 'mystery',
    focused: false,
    revision: 1,
  },
]
