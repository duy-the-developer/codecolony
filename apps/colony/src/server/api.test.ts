import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FAKE_BACKLOG,
  makeFirstmateHome,
} from '../modules/build-queue/testing/firstmate-home-fixture.ts'
import type { ColonyConfig } from '../modules/config/load-config.ts'
import type {
  BuildQueueResponse,
  ColonistsResponse,
  FileResponse,
} from '../modules/wire/api-types.ts'
import type { Edge, World, WorldNode, WorldPayload } from '../modules/world/world-types.ts'
import { type ColonistSource, createApi, type WorldSource } from './api.ts'

const RECT = { x: 0, y: 0, w: 4, h: 4 }

// world > a.ts > its function `start`.
const NODES: WorldNode[] = [
  { id: 'world', kind: 'world', name: 'world', lines: 10, complexity: 0, rect: RECT },
  {
    id: 'p/r/a.ts',
    parent: 'world',
    kind: 'file',
    name: 'a.ts',
    path: 'a.ts',
    lines: 10,
    complexity: 0,
    rect: RECT,
  },
  {
    id: 'p/r/a.ts#start',
    parent: 'p/r/a.ts',
    kind: 'symbol',
    name: 'start',
    path: 'a.ts',
    lines: 3,
    complexity: 0,
    rect: RECT,
    symbolKind: 'function',
    range: { start: 2, end: 4 },
  },
]

class StubSource extends EventEmitter<{ update: [World] }> implements WorldSource {
  world: World = {
    version: 1,
    indexedAt: '2026-01-01T00:00:00Z',
    languages: {},
    nodes: NODES,
    edges: [],
  }
  deepIndex(fileId: string): Promise<Edge[]> {
    if (fileId === 'broken') return Promise.reject(new Error('server crashed'))
    return Promise.resolve([
      { from: `${fileId}#a`, to: `${fileId}#b`, kind: 'call', provenance: 'lsp' },
    ])
  }
  readFile(fileId: string): Promise<FileResponse | undefined> {
    if (fileId === 'broken') return Promise.reject(new Error('git failed'))
    if (fileId !== 'p/r/a.ts') return Promise.resolve(undefined)
    return Promise.resolve({
      id: fileId,
      path: 'a.ts',
      commit: 'abc123',
      isBinary: false,
      text: 'export const a = 1\n',
    })
  }
}

class StubColonists implements ColonistSource {
  snapshot: ColonistsResponse = {
    version: 1,
    colonists: [
      {
        id: '/work/copy',
        repoId: 'p/r',
        label: 'fix-a',
        status: 'working',
        session: 'own',
        copy: '~/work/copy',
        head: 'abc1234',
        base: 'main',
        changes: [{ path: 'a.ts', kind: 'modified', units: 1 }],
        omitted: 0,
      },
    ],
  }
  private readonly listeners = new Set<(snapshot: ColonistsResponse) => void>()
  onChange(listener: (snapshot: ColonistsResponse) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  publish(snapshot: ColonistsResponse): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

const TOKEN = 'secret'
const AUTH = { authorization: `Bearer ${TOKEN}` }

describe('api', () => {
  let server: Server
  let base: string
  const source = new StubSource()
  const colonists = new StubColonists()

  beforeAll(async () => {
    const api = createApi(
      {
        projects: [{ name: 'demo', root: '/private/path/demo', kind: 'repo' }],
        cacheDir: '/cache',
        source: 'default',
        port: 0,
      },
      {
        world: source,
        colonists,
        deny: (req) => (req.headers.authorization === `Bearer ${TOKEN}` ? null : 401),
      },
    )
    server = createServer((req, res) => {
      if (!api(req, res)) res.writeHead(418).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('lists projects by name and kind without their local roots', async () => {
    const response = await fetch(`${base}/api/projects`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ projects: [{ name: 'demo', kind: 'repo' }] })
  })

  it('serves the current world without its symbols', async () => {
    const world = (await (await fetch(`${base}/api/world`)).json()) as WorldPayload
    expect(world).toMatchObject({ type: 'full', version: 1 })
    expect(world.nodes.map((row) => row[3])).toEqual(['world', 'p/r/a.ts'])
  })

  it('sends a page that holds the current version an empty patch', async () => {
    const { session } = (await (await fetch(`${base}/api/world`)).json()) as WorldPayload
    const patch = await (await fetch(`${base}/api/world?session=${session}&since=1`)).json()
    expect(patch).toMatchObject({ type: 'patch', base: 1, version: 1, nodes: [], edges: [] })
    const other = await (await fetch(`${base}/api/world?session=other&since=1`)).json()
    expect(other).toMatchObject({ type: 'full' })
  })

  it('serves symbols for files of the current version, and refuses a stale one', async () => {
    const { session } = (await (await fetch(`${base}/api/world`)).json()) as WorldPayload
    const ok = await fetch(`${base}/api/symbols?session=${session}&version=1&files=1`)
    expect(await ok.json()).toEqual({
      version: 1,
      files: { 1: [[-1, 'start', null, 0, 2, 4, -1, 0]] },
    })
    expect((await fetch(`${base}/api/symbols?session=${session}&version=0&files=1`)).status).toBe(
      409,
    )
    expect((await fetch(`${base}/api/symbols?session=other&version=1&files=1`)).status).toBe(409)
    expect((await fetch(`${base}/api/symbols?version=1&files=1`)).status).toBe(400)
    expect((await fetch(`${base}/api/symbols?session=${session}&version=1`)).status).toBe(400)
    expect((await fetch(`${base}/api/symbols?session=${session}&version=1&files=x`)).status).toBe(
      400,
    )
  })

  it('searches files and symbols by name', async () => {
    const response = await fetch(`${base}/api/search?q=sta&limit=5`)
    expect(await response.json()).toEqual({
      symbols: [
        {
          id: 'p/r/a.ts#start',
          kind: 'symbol',
          name: 'start',
          path: 'a.ts',
          symbolKind: 'function',
          line: 2,
          lines: 3,
        },
      ],
      files: [],
    })
  })

  it('answers a deep index with LSP edges, and reports failures', async () => {
    const ok = await fetch(`${base}/api/deep?file=${encodeURIComponent('p/r/a.ts')}`)
    expect(await ok.json()).toEqual({
      edges: [{ from: 'p/r/a.ts#a', to: 'p/r/a.ts#b', kind: 'call', provenance: 'lsp' }],
    })
    expect((await fetch(`${base}/api/deep?file=broken`)).status).toBe(502)
    expect((await fetch(`${base}/api/deep`)).status).toBe(400)
  })

  it('serves a file on the map with the token, and nothing else', async () => {
    const fileUrl = (id: string) => `${base}/api/file?id=${encodeURIComponent(id)}`
    const ok = await fetch(fileUrl('p/r/a.ts'), { headers: AUTH })
    expect(await ok.json()).toEqual({
      id: 'p/r/a.ts',
      path: 'a.ts',
      commit: 'abc123',
      isBinary: false,
      text: 'export const a = 1\n',
    })
    expect((await fetch(fileUrl('p/r/a.ts'))).status).toBe(401)
    expect((await fetch(fileUrl('p/r/../../etc/passwd'), { headers: AUTH })).status).toBe(404)
    expect((await fetch(fileUrl('broken'), { headers: AUTH })).status).toBe(502)
    expect((await fetch(`${base}/api/file`, { headers: AUTH })).status).toBe(400)
  })

  it('serves the colonists with the token only', async () => {
    const ok = await fetch(`${base}/api/colonists`, { headers: AUTH })
    expect(await ok.json()).toEqual(colonists.snapshot)
    expect((await fetch(`${base}/api/colonists`)).status).toBe(401)
  })

  it('streams a world event now and on every update', async () => {
    const response = await fetch(`${base}/api/events`)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('no body')
    const decoder = new TextDecoder()
    let text = ''
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read()
        if (done) throw new Error('stream ended')
        text += decoder.decode(value)
      }
    }
    await readUntil('"version":1')
    source.world = { ...source.world, version: 2 }
    source.emit('update', source.world)
    await readUntil('"version":2')
    expect(text).toContain('event: colonists\ndata: {"version":1}')
    colonists.publish({ version: 7, colonists: [] })
    await readUntil('event: colonists\ndata: {"version":7}')
    await reader.cancel()
  })

  it('says the build queue is not connected without a firstmate home', async () => {
    expect(await (await fetch(`${base}/api/build-queue`)).json()).toEqual({ isConnected: false })
    expect((await fetch(`${base}/api/build-queue/changes?id=x`)).status).toBe(404)
  })

  it('rejects writes and unknown api paths', async () => {
    expect((await fetch(`${base}/api/world`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
  })

  it('leaves other paths to the page', async () => {
    expect((await fetch(`${base}/`)).status).toBe(418)
  })
})

describe('api with a firstmate home', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    const config: ColonyConfig = {
      projects: [{ name: 'app', root: '/private/path/app', kind: 'repo' }],
      cacheDir: '/cache',
      firstmateHome: makeFirstmateHome({ backlog: FAKE_BACKLOG }),
      source: 'default',
      port: 0,
    }
    const api = createApi(config, {
      world: new StubSource(),
      colonists: new StubColonists(),
      deny: () => null,
    })
    server = createServer((req, res) => {
      if (!api(req, res)) res.writeHead(418).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it("serves the map's orders from the backlog", async () => {
    const body = (await (await fetch(`${base}/api/build-queue`)).json()) as BuildQueueResponse
    const ids = body.isConnected ? body.orders.map((order) => order.id) : []
    expect(ids).toContain('app-wiring')
    expect(ids).not.toContain('other-site')
  })

  it('has no changes for an order without a worker copy, and needs an id', async () => {
    expect((await fetch(`${base}/api/build-queue/changes?id=app-queue`)).status).toBe(404)
    expect((await fetch(`${base}/api/build-queue/changes`)).status).toBe(400)
  })
})
