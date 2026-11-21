import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ColonyConfig } from '../config/load-config.ts'
import type { FileResponse, ProjectsResponse, SearchMatches } from '../shared/api-types.ts'
import { createWorldEncoder } from '../shared/world-encoder.ts'
import type { DeepResponse, Edge, World } from '../shared/world-types.ts'
import { buildSearchIndex, listSearchMatches, type SearchIndex } from './search-index.ts'

// The part of the Colony the API reads; tests pass a stub.
export interface WorldSource {
  readonly world: World
  deepIndex(fileId: string): Promise<Edge[]>
  readFile(fileId: string): Promise<FileResponse | undefined>
  on(event: 'update', listener: (world: World) => void): unknown
  off(event: 'update', listener: (world: World) => void): unknown
}

// Refuses a request to a token-guarded route with a status, or lets it
// through with null; the dock's own guard in the app.
export type DenyRequest = (req: IncomingMessage) => number | null

const HEARTBEAT_MS = 25_000
const MAX_SEARCH_LIMIT = 50
const MAX_SYMBOL_FILES = 500

// Answers /api/* and returns true, or returns false to let the page handle it.
// Source text is token-guarded; the map's shape is guarded by the loopback
// Host check alone.
export function createApi(config: ColonyConfig, source: WorldSource, deny: DenyRequest) {
  const encoder = createWorldEncoder()
  let search: { world: World; index: SearchIndex } | undefined
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
      // ?session=S&since=V: the page holds version V and wants what changed.
      const session = url.searchParams.get('session')
      const since = Number(url.searchParams.get('since'))
      const body = encoder.encodeWorld(
        source.world,
        session && Number.isInteger(since) ? { session, version: since } : undefined,
      )
      res.writeHead(200, { 'content-type': 'application/json' }).end(body)
    } else if (pathname === '/api/symbols') {
      const session = url.searchParams.get('session')
      const version = Number(url.searchParams.get('version'))
      const files = url.searchParams.get('files')?.split(',').map(Number) ?? []
      const isValid =
        session !== null &&
        Number.isInteger(version) &&
        files.length > 0 &&
        files.length <= MAX_SYMBOL_FILES &&
        files.every((file) => Number.isInteger(file) && file >= 0)
      if (!isValid) {
        json(res, 400, { error: 'session, version and up to 500 file indices are required' })
      } else {
        const body = encoder.encodeSymbols(source.world, { session, version }, files)
        if (body) json(res, 200, body)
        else json(res, 409, { error: 'the world has moved on from this version' })
      }
    } else if (pathname === '/api/search') {
      const limit = Number(url.searchParams.get('limit') ?? 8)
      if (search?.world !== source.world) {
        search = { world: source.world, index: buildSearchIndex(source.world) }
      }
      const body: SearchMatches = listSearchMatches(
        search.index,
        url.searchParams.get('q') ?? '',
        Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT) : 8,
      )
      json(res, 200, body)
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
    } else if (pathname === '/api/file') {
      file(req, res, url.searchParams.get('id'), source, deny)
    } else {
      json(res, 404, { error: 'not found' })
    }
    return true
  }
}

function file(
  req: IncomingMessage,
  res: ServerResponse,
  id: string | null,
  source: WorldSource,
  deny: DenyRequest,
): void {
  const denied = deny(req)
  if (denied) {
    json(res, denied, { error: denied === 401 ? 'missing or wrong token' : 'forbidden' })
  } else if (!id) {
    json(res, 400, { error: 'id is required' })
  } else {
    source.readFile(id).then(
      (body) => {
        if (body) json(res, 200, body satisfies FileResponse)
        else json(res, 404, { error: 'no such file on the map' })
      },
      (error: unknown) => json(res, 502, { error: (error as Error).message }),
    )
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
