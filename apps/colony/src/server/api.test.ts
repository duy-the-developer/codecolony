import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Edge, World } from '../shared/world-types.ts'
import { createApi, type WorldSource } from './api.ts'

class StubSource extends EventEmitter<{ update: [World] }> implements WorldSource {
  world: World = {
    version: 1,
    indexedAt: '2026-01-01T00:00:00Z',
    languages: {},
    nodes: [],
    edges: [],
  }
  deepIndex(fileId: string): Promise<Edge[]> {
    if (fileId === 'broken') return Promise.reject(new Error('server crashed'))
    return Promise.resolve([
      { from: `${fileId}#a`, to: `${fileId}#b`, kind: 'call', provenance: 'lsp' },
    ])
  }
}

describe('api', () => {
  let server: Server
  let base: string
  const source = new StubSource()

  beforeAll(async () => {
    const api = createApi(
      {
        projects: [{ name: 'demo', root: '/private/path/demo', kind: 'repo' }],
        cacheDir: '/cache',
        source: 'default',
        port: 0,
      },
      source,
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

  it('serves the current world', async () => {
    expect(await (await fetch(`${base}/api/world`)).json()).toMatchObject({ version: 1 })
  })

  it('answers a deep index with LSP edges, and reports failures', async () => {
    const ok = await fetch(`${base}/api/deep?file=${encodeURIComponent('p/r/a.ts')}`)
    expect(await ok.json()).toEqual({
      edges: [{ from: 'p/r/a.ts#a', to: 'p/r/a.ts#b', kind: 'call', provenance: 'lsp' }],
    })
    expect((await fetch(`${base}/api/deep?file=broken`)).status).toBe(502)
    expect((await fetch(`${base}/api/deep`)).status).toBe(400)
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
    await reader.cancel()
  })

  it('rejects writes and unknown api paths', async () => {
    expect((await fetch(`${base}/api/world`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
  })

  it('leaves other paths to the page', async () => {
    expect((await fetch(`${base}/`)).status).toBe(418)
  })
})
