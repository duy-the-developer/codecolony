import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadBuildQueue, loadOrderChanges } from '../modules/build-queue/load-build-queue.ts'
import type { ColonyConfig } from '../modules/config/load-config.ts'
import {
  buildSearchIndex,
  listSearchMatches,
  type SearchIndex,
} from '../modules/search/search-index.ts'
import type {
  BuildQueueResponse,
  ColonistsResponse,
  FileResponse,
  OrderChangesResponse,
  ProjectsResponse,
  SearchMatches,
} from '../modules/wire/api-types.ts'
import { createWorldEncoder } from '../modules/wire/world-encoder.ts'
import type { DeepResponse, Edge, World } from '../modules/world/world-types.ts'

// The part of the Colony the API reads; tests pass a stub.
export interface WorldSource {
  readonly world: World
  deepIndex(fileId: string): Promise<Edge[]>
  readFile(fileId: string): Promise<FileResponse | undefined>
  on(event: 'update', listener: (world: World) => void): unknown
  off(event: 'update', listener: (world: World) => void): unknown
}

// The colonists the API serves; tests pass a stub.
export interface ColonistSource {
  readonly snapshot: ColonistsResponse
  onChange(listener: (snapshot: ColonistsResponse) => void): () => void
}

// Refuses a request to a token-guarded route with a status, or lets it
// through with null; the dock's own guard in the app.
export type DenyRequest = (req: IncomingMessage) => number | null

export interface ApiDeps {
  world: WorldSource
  colonists: ColonistSource
  deny: DenyRequest
}

const HEARTBEAT_MS = 25_000
const MAX_SEARCH_LIMIT = 50
const MAX_SYMBOL_FILES = 500

// Answers /api/* and returns true, or returns false to let the page handle it.
// Source text and colonists (folders, agent status lines) are token-guarded;
// the map's shape is guarded by the loopback Host check alone.
export function createApi(config: ColonyConfig, { world: source, colonists, deny }: ApiDeps) {
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
    } else if (pathname === '/api/colonists') {
      const denied = deny(req)
      if (denied) json(res, denied, { error: deniedMessage(denied) })
      else json(res, 200, colonists.snapshot satisfies ColonistsResponse)
    } else if (pathname === '/api/events') {
      events(req, res, source, colonists)
    } else if (pathname === '/api/deep') {
      const file = url.searchParams.get('file')
      if (!file) json(res, 400, { error: 'file is required' })
      else
        source.deepIndex(file).then(
          (edges) => json(res, 200, { edges } satisfies DeepResponse),
          (error: unknown) => json(res, 502, { error: (error as Error).message }),
        )
    } else if (pathname === '/api/build-queue') {
      buildQueue(res, config)
    } else if (pathname === '/api/build-queue/changes') {
      orderChanges(res, config, url.searchParams.get('id'))
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
    json(res, denied, { error: deniedMessage(denied) })
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

// The firstmate home's orders for the projects on the map.
function buildQueue(res: ServerResponse, config: ColonyConfig): void {
  const home = config.firstmateHome
  if (!home) {
    json(res, 200, { isConnected: false } satisfies BuildQueueResponse)
    return
  }
  loadBuildQueue(home, config.projects).then(
    (orders) => json(res, 200, { isConnected: true, orders } satisfies BuildQueueResponse),
    (error: unknown) => json(res, 502, { error: (error as Error).message }),
  )
}

function orderChanges(res: ServerResponse, config: ColonyConfig, id: string | null): void {
  const home = config.firstmateHome
  if (!home) {
    json(res, 404, { error: 'no firstmate home is configured' })
  } else if (!id) {
    json(res, 400, { error: 'id is required' })
  } else {
    loadOrderChanges(home, config.projects, id).then(
      (body) => {
        if (body) json(res, 200, body satisfies OrderChangesResponse)
        else json(res, 404, { error: 'no worker copy for this order' })
      },
      (error: unknown) => json(res, 502, { error: (error as Error).message }),
    )
  }
}

// Server-sent events: one `world` event per new world version and one
// `colonists` event per new colonists snapshot. Neither carries the data
// itself, so the stream needs no token.
function events(
  req: IncomingMessage,
  res: ServerResponse,
  source: WorldSource,
  colonists: ColonistSource,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  const send = (world: World) => {
    res.write(`event: world\ndata: ${JSON.stringify({ version: world.version })}\n\n`)
  }
  const sendColonists = ({ version }: ColonistsResponse) => {
    res.write(`event: colonists\ndata: ${JSON.stringify({ version })}\n\n`)
  }
  send(source.world)
  sendColonists(colonists.snapshot)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  source.on('update', send)
  const unsubscribe = colonists.onChange(sendColonists)
  req.on('close', () => {
    clearInterval(heartbeat)
    source.off('update', send)
    unsubscribe()
  })
}

function deniedMessage(status: number): string {
  return status === 401 ? 'missing or wrong token' : 'forbidden'
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
