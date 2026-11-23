import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFacts } from './parse-facts.ts'
import { createParsePool, type ParsePoolHandle } from './parse-pool.ts'

// The app's own source is the corpus: real TypeScript with every symbol kind,
// imports, calls, branches and HTTP routes, plus a few non-code files.
const SRC = fileURLToPath(new URL('../../', import.meta.url))

function listCorpus(): { path: string; bytes: Buffer }[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map((file) => ({ path: relative(SRC, file), bytes: readFileSync(file) }))
}

const pools: ParsePoolHandle[] = []
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()))
})

function poolOf(size: number, idleMs?: number): ParsePoolHandle {
  const pool = createParsePool(idleMs === undefined ? { size } : { size, idleMs })
  pools.push(pool)
  return pool
}

describe('createParsePool', () => {
  // Four workers parse the whole corpus; next to the rest of the suite that
  // can take longer than the default 5 s.
  it('gives exactly the facts the main thread does', async () => {
    const corpus = listCorpus()
    expect(corpus.length).toBeGreaterThan(50)
    const pool = poolOf(4)
    const [pooled, inline] = await Promise.all([
      Promise.all(corpus.map(({ path, bytes }) => pool.parse(path, bytes))),
      Promise.all(corpus.map(({ path, bytes }) => parseFacts(path, bytes))),
    ])
    expect(pooled.some((facts) => facts.symbols.length > 0 && facts.complexity > 0)).toBe(true)
    expect(pooled).toEqual(inline)
  }, 30_000)

  it('keeps the caller buffer intact when it sends a slice of it', async () => {
    const shared = Buffer.from('export const a = 1\nexport function b() {}\n')
    const slice = shared.subarray(19)
    const facts = await poolOf(1).parse('b.ts', slice)
    expect(facts.symbols.map((s) => s.name)).toEqual(['b'])
    expect(shared.byteLength).toBeGreaterThan(0)
    expect(slice.toString()).toBe('export function b() {}\n')
  })

  it('starts again after its workers stop for being idle', async () => {
    const pool = poolOf(2, 10)
    const first = await pool.parse('a.ts', Buffer.from('export function a() {}\n'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    const second = await pool.parse('a.ts', Buffer.from('export function a() {}\n'))
    expect(second).toEqual(first)
  })

  it('rejects files sent after close', async () => {
    const pool = poolOf(1)
    await pool.close()
    await expect(pool.parse('a.ts', Buffer.from(''))).rejects.toMatchObject({ code: 'Closed' })
  })
})
