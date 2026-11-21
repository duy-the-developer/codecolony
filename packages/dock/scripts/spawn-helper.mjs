// node-pty's macOS prebuilds ship spawn-helper without the executable bit when
// installed by pnpm, and every spawn then fails with "posix_spawnp failed".
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const prebuilds = join(dirname(require.resolve('node-pty/package.json')), 'prebuilds')
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
