import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config/load-config.ts'
import { log } from '../shared/log.ts'
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
log('Indexed', {
  repositories: count('repo'),
  ms: Math.round(performance.now() - started),
  files: count('file'),
  parsed: sum('parsed'),
  cached: sum('reused'),
  vendored: sum('skipped'),
  symbols: count('symbol'),
  edges: edges.length,
  cacheDir: config.cacheDir,
})
await colony.close()
