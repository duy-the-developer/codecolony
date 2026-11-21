import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApi } from './api.ts'

describe('api', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    const api = createApi({
      projects: [{ name: 'demo', root: '/private/path/demo', kind: 'repo' }],
      cacheDir: '/cache',
      source: 'default',
    })
    server = createServer((req, res) => {
      if (!api(req, res)) res.writeHead(418).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('lists projects by name and kind without their local roots', async () => {
    const response = await fetch(`${base}/api/projects`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ projects: [{ name: 'demo', kind: 'repo' }] })
  })

  it('answers unknown api paths with 404', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
  })

  it('leaves other paths to the page', async () => {
    expect((await fetch(`${base}/`)).status).toBe(418)
  })
})
