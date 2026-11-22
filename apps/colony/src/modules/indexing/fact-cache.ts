import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileFacts } from '../world/facts.ts'
import { writeAtomic } from './atomic-write.ts'

// Facts are content-addressed: a blob's facts depend only on its bytes, its
// path's language and the rules version, so every project and every commit
// shares one cache. It lives outside the repositories (config.cacheDir).

export class FactCache {
  private readonly dir: string

  constructor(cacheDir: string, rulesVersion: string) {
    const rules = createHash('sha1').update(rulesVersion).digest('hex').slice(0, 12)
    this.dir = join(cacheDir, 'facts', rules)
  }

  get(key: string): FileFacts | undefined {
    try {
      return JSON.parse(readFileSync(this.path(key), 'utf8')) as FileFacts
    } catch {
      return undefined
    }
  }

  set(key: string, facts: FileFacts): void {
    writeAtomic(this.path(key), JSON.stringify(facts))
  }

  private path(key: string): string {
    return join(this.dir, key.slice(0, 2), `${key}.json`)
  }
}

// The same blob can be read by two adapters (a .js and a .ts copy), so the
// key holds the language too.
export function factKey(sha: string, language: string): string {
  return `${sha}-${language}`
}
