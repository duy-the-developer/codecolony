import { describe, expect, it } from 'vitest'
import { commit, git, makeRepo, makeTempDir } from '../testing/git-fixture.ts'
import { FactCache } from './cache.ts'
import { buildTextFacts, parseFacts } from './parse-facts.ts'
import { indexRepo, type ParseBlob } from './repo.ts'

function counting(parse: ParseBlob): { parse: ParseBlob; paths: string[] } {
  const paths: string[] = []
  return {
    paths,
    parse: (path, bytes) => {
      paths.push(path)
      return parse(path, bytes)
    },
  }
}

const realParse: ParseBlob = async (path, bytes) => ({
  facts: await parseFacts(path, bytes),
  provisional: false,
})

// Stands in for a parse worker that died on a.ts.
const workerDiesOnA: ParseBlob = async (path, bytes) =>
  path === 'a.ts'
    ? { facts: buildTextFacts(bytes), provisional: true }
    : { facts: await parseFacts(path, bytes), provisional: false }

describe('indexRepo', () => {
  it('maps provisional facts for this index but parses the file again next time', async () => {
    const root = makeRepo({
      'a.ts': 'export function a() {\n  return 1\n}\n',
      'b.ts': 'export function b() {\n  return 2\n}\n',
    })
    const cacheDir = makeTempDir()
    const initial = git(root, 'rev-parse', 'HEAD')

    const first = await indexRepo(
      root,
      initial,
      new FactCache(cacheDir, 'test'),
      undefined,
      workerDiesOnA,
    )
    const a = first.index.files.find((file) => file.path === 'a.ts')
    expect(a?.facts.symbols).toEqual([])
    expect(a?.facts.lines).toBe(3)

    // The next index after HEAD moves parses a.ts again rather than reusing it.
    const moved = commit(root, { 'c.ts': 'export const c = 3\n' })
    const next = counting(realParse)
    const second = await indexRepo(
      root,
      moved,
      new FactCache(cacheDir, 'test'),
      first.index,
      next.parse,
    )
    expect(next.paths.sort()).toEqual(['a.ts', 'c.ts'])
    const reparsed = second.index.files.find((file) => file.path === 'a.ts')
    expect(reparsed?.facts.symbols.map((s) => s.name)).toEqual(['a'])

    // A fresh start reads nothing provisional from the cache either.
    const fresh = makeTempDir()
    await indexRepo(root, moved, new FactCache(fresh, 'test'), undefined, workerDiesOnA)
    const restart = counting(realParse)
    await indexRepo(root, moved, new FactCache(fresh, 'test'), undefined, restart.parse)
    expect(restart.paths).toEqual(['a.ts'])
  })
})
