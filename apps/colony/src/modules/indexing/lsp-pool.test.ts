import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LanguageServerSpec } from '../language/language-adapter.ts'
import { LspError, type LspSession } from '../language/lsp.ts'
import { LspPool, type LspPoolOptions } from './lsp-pool.ts'
import { createFakeLsp } from './testing/fake-lsp.ts'
import { makeTempDir, writeFiles } from './testing/git-fixture.ts'

const pools: LspPool[] = []
afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()))
  vi.restoreAllMocks()
})

function makePool(options: LspPoolOptions = {}): LspPool {
  const pool = new LspPool(options)
  pools.push(pool)
  return pool
}

function makeRoot(): string {
  const root = makeTempDir()
  writeFiles(root, { 'a.ts': 'export function caller() {}\n' })
  return root
}

// The name of the callee, which carries the fake server's pid.
async function calleeOf(pool: LspPool, spec: LanguageServerSpec, root: string): Promise<string> {
  return pool.use('fake', spec, root, async (session) => {
    const calls = await session.outgoingCalls(
      { path: join(root, 'a.ts'), line: 1, column: 0 },
      'caller',
    )
    return calls[0]?.name ?? ''
  })
}

function silenceLogs(): { lines: () => string[] } {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return {
    lines: () => [...log.mock.calls, ...error.mock.calls].map((args) => String(args[0])),
  }
}

describe('LspPool', () => {
  it('answers outgoing calls through a running server', async () => {
    silenceLogs()
    const pool = makePool()
    const root = makeRoot()
    const spec = createFakeLsp()
    const first = await calleeOf(pool, spec, root)
    expect(first).toMatch(/^callee-\d+$/)
    expect(await calleeOf(pool, spec, root)).toBe(first)
    expect(pool.size).toBe(1)
  })

  it('fails the pending request when the server exits, logs it, and restarts on next use', async () => {
    const logs = silenceLogs()
    const pool = makePool()
    const root = makeRoot()
    const spec = createFakeLsp({ crashOnPrepare: 1 })
    const started = Date.now()
    const crash = await calleeOf(pool, spec, root).catch((error: unknown) => error)
    expect(crash).toBeInstanceOf(LspError)
    expect((crash as LspError).code).toBe('Exited')
    // Well before any timeout.
    expect(Date.now() - started).toBeLessThan(10_000)
    await vi.waitFor(() => expect(pool.size).toBe(0))
    expect(logs.lines()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Language server stderr server=fake'),
        expect.stringMatching(/Language server exited .*code=134/),
      ]),
    )
    expect(logs.lines().join('\n')).toContain('FATAL ERROR: Reached heap limit')

    // The restarted server is a new process; it crashes only on its own first
    // request, so hand it a spec that does not crash.
    const healthy = await calleeOf(pool, createFakeLsp(), root)
    expect(healthy).toMatch(/^callee-\d+$/)
  })

  it('gives the first request the load timeout and later ones the request timeout', async () => {
    silenceLogs()
    const pool = makePool({ session: { loadTimeoutMs: 5_000, requestTimeoutMs: 300 } })
    const root = makeRoot()
    const spec = createFakeLsp({ prepareDelaysMs: [1_000, 1_000] })
    expect(await calleeOf(pool, spec, root)).toMatch(/^callee-/)
    const late = await calleeOf(pool, spec, root).catch((error: unknown) => error)
    expect((late as LspError).code).toBe('Timeout')
  })

  it('kills a server that hangs on shutdown after the request timeout, even before it loaded', async () => {
    silenceLogs()
    const pool = makePool({ session: { loadTimeoutMs: 60_000, requestTimeoutMs: 300 } })
    const spec = createFakeLsp({ hangOnShutdown: true })
    let session: LspSession | undefined
    await pool.use('fake', spec, makeRoot(), async (s) => {
      session = s
    })
    const started = Date.now()
    await pool.close()
    expect(Date.now() - started).toBeLessThan(5_000)
    await vi.waitFor(() => expect(session?.isAlive).toBe(false))
  })

  it('closes the least recently used idle session beyond its cap', async () => {
    silenceLogs()
    const pool = makePool({ maxSessions: 2 })
    const roots = [makeRoot(), makeRoot(), makeRoot()]
    const spec = createFakeLsp()
    const sessions: LspSession[] = []
    for (const root of [roots[0], roots[1], roots[0], roots[2]]) {
      await pool.use('fake', spec, root ?? '', async (session) => {
        sessions.push(session)
      })
    }
    expect(pool.size).toBe(2)
    // roots[1] was the least recently used, so its server is the one closed.
    await vi.waitFor(() => expect(sessions[1]?.isAlive).toBe(false))
    expect(sessions[0]?.isAlive).toBe(true)
    expect(sessions[3]?.isAlive).toBe(true)
  })

  it('never closes a session that is in use', async () => {
    silenceLogs()
    const pool = makePool({ maxSessions: 1 })
    const [a, b] = [makeRoot(), makeRoot()]
    const spec = createFakeLsp()
    await pool.use('fake', spec, a, async (outer) => {
      await pool.use('fake', spec, b, async () => {})
      expect(outer.isAlive).toBe(true)
      expect(await calleeOf(pool, spec, a)).toMatch(/^callee-/)
    })
    expect(pool.size).toBe(1)
  })
})
