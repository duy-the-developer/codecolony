import { fileURLToPath } from 'node:url'
import { loadConfig } from '../server/config.ts'
import { Colony } from './colony.ts'

// `pnpm index`: indexes every configured project once and prints a summary.

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const config = loadConfig({ repoRoot })
const colony = new Colony(config)
const started = performance.now()
const { stats } = await colony.refresh()
const { nodes, edges } = colony.world
const count = (kind: string) => nodes.filter((node) => node.kind === kind).length
const sum = (key: 'parsed' | 'reused' | 'skipped') => stats.reduce((n, s) => n + s[key], 0)
console.log(
  `Indexed ${count('repo')} repositories in ${Math.round(performance.now() - started)} ms: ` +
    `${count('file')} files (${sum('parsed')} parsed, ${sum('reused')} cached, ${sum('skipped')} vendored), ` +
    `${count('symbol')} symbols, ${edges.length} edges. Cache: ${config.cacheDir}`,
)
await colony.close()
