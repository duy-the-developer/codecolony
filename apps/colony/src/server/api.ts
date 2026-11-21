import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProjectsResponse } from '../shared/api.ts'
import type { DeepResponse, Edge, World } from '../shared/world.ts'
import type { ColonyConfig } from './config.ts'

// The part of the Colony the API reads; tests pass a stub.
export interface WorldSource {
  readonly world: World
  deepIndex(fileId: string): Promise<Edge[]>
  on(event: 'update', listener: (world: World) => void): unknown
  off(event: 'update', listener: (world: World) => void): unknown
}

const HEARTBEAT_MS = 25_000

// Answers /api/* and returns true, or returns false to let the page handle it.
export function createApi(config: ColonyConfig, source: WorldSource) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url
    if (!pathname.startsWith('/api/')) return false
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
    } else if (pathname === '/api/projects') {
      const body: ProjectsResponse = {
        projects: config.projects.map(({ name, kind }) => ({ name, kind })),
      }
      json(res, 200, body)
    } else if (pathname === '/api/world') {
      json(res, 200, source.world)
    } else if (pathname === '/api/events') {
      events(req, res, source)
    } else if (pathname === '/api/deep') {
      const file = url.searchParams.get('file')
      if (!file) json(res, 400, { error: 'file is required' })
      else
        source.deepIndex(file).then(
          (edges) => json(res, 200, { edges } satisfies DeepResponse),
          (error: unknown) => json(res, 502, { error: (error as Error).message }),
        )
    } else {
      json(res, 404, { error: 'not found' })
    }
    return true
  }
}

// Server-sent events: one `world` event per new world version.
function events(req: IncomingMessage, res: ServerResponse, source: WorldSource): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  const send = (world: World) => {
    res.write(`event: world\ndata: ${JSON.stringify({ version: world.version })}\n\n`)
  }
  send(source.world)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  source.on('update', send)
  req.on('close', () => {
    clearInterval(heartbeat)
    source.off('update', send)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
