import { createConnection } from 'node:net'
import { WORKER_STATUSES, type Worker, type WorkerStatus } from '../shared/protocol.ts'

// A client for the Herdr API socket. Each request opens the unix socket, writes
// one JSON line `{id, method, params}` and reads one JSON line back:
// `{id, result}` or `{id, error: {code, message}}`. Herdr closes the
// connection after the reply.

const TIMEOUT_MS = 5000
const MAX_REPLY_BYTES = 8 * 1024 * 1024

export class HerdrError extends Error {
  override name = 'HerdrError'
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface HerdrApi {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  listWorkers(): Promise<Worker[]>
  focusPane(paneId: string): Promise<void>
}

export function createHerdrApi(socketPath: string, timeoutMs = TIMEOUT_MS): HerdrApi {
  let nextId = 0

  function request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = `codecolony:${method}:${++nextId}`
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath)
      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (error: Error | null, value?: unknown) => {
        if (settled) return
        settled = true
        socket.destroy()
        if (error) reject(error)
        else resolve(value)
      }
      socket.setTimeout(timeoutMs, () =>
        finish(new HerdrError('timeout', `Herdr did not answer ${method} in ${timeoutMs} ms`)),
      )
      socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`))
      socket.on('error', (error) =>
        finish(new HerdrError('unavailable', `Herdr socket ${socketPath}: ${error.message}`)),
      )
      socket.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_REPLY_BYTES) {
          finish(new HerdrError('too_large', `Herdr reply to ${method} is too large`))
          return
        }
        chunks.push(chunk)
        const text = Buffer.concat(chunks).toString('utf8')
        const end = text.indexOf('\n')
        if (end === -1) return
        try {
          finish(null, readReply(text.slice(0, end), id, method))
        } catch (error) {
          finish(error as Error)
        }
      })
      socket.on('end', () =>
        finish(new HerdrError('protocol', `Herdr closed the socket without answering ${method}`)),
      )
    })
  }

  return {
    request,
    async listWorkers() {
      const result = await request('agent.list')
      if (!isRecord(result) || result.type !== 'agent_list' || !Array.isArray(result.agents)) {
        throw new HerdrError('protocol', 'agent.list returned an unexpected shape')
      }
      return result.agents.flatMap(toWorker)
    },
    async focusPane(paneId) {
      await request('pane.focus', { pane_id: paneId })
    },
  }
}

function readReply(line: string, id: string, method: string): unknown {
  let reply: unknown
  try {
    reply = JSON.parse(line)
  } catch {
    throw new HerdrError('protocol', `Herdr answered ${method} with invalid JSON`)
  }
  if (!isRecord(reply) || reply.id !== id) {
    throw new HerdrError('protocol', `Herdr answered ${method} with an unexpected reply`)
  }
  if (isRecord(reply.error)) {
    const { code, message } = reply.error
    throw new HerdrError(
      typeof code === 'string' ? code : 'error',
      typeof message === 'string' ? message : `${method} failed`,
    )
  }
  if (!('result' in reply)) {
    throw new HerdrError('protocol', `Herdr answered ${method} without a result`)
  }
  return reply.result
}

// Keeps only what the map needs; working directories and titles stay on the server.
function toWorker(agent: unknown): Worker[] {
  if (!isRecord(agent)) return []
  const { pane_id, workspace_id, agent: kind, name, agent_status, focused } = agent
  if (typeof pane_id !== 'string' || typeof workspace_id !== 'string') return []
  return [
    {
      paneId: pane_id,
      workspaceId: workspace_id,
      agent: typeof kind === 'string' ? kind : null,
      name: typeof name === 'string' ? name : null,
      status: isWorkerStatus(agent_status) ? agent_status : 'unknown',
      focused: focused === true,
    },
  ]
}

function isWorkerStatus(value: unknown): value is WorkerStatus {
  return WORKER_STATUSES.some((status) => status === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
