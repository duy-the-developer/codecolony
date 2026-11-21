import type { LanguageServerSpec } from '../core/language-adapter.ts'
import { LspSession, type LspSessionOptions, resolveLspMemoryBudget } from '../core/lsp.ts'
import { log, logError } from '../shared/log.ts'

// The language servers the colony keeps running, one per language and
// repository. A server that exits is started again on next use, and only the
// most recently used ones stay open: each can hold gigabytes.

export interface LspPoolOptions {
  maxSessions?: number
  // Passed to every session; tests shorten the timeouts.
  session?: Pick<LspSessionOptions, 'loadTimeoutMs' | 'requestTimeoutMs'>
}

interface PoolEntry {
  context: { server: string; root: string }
  session: Promise<LspSession>
  // Callers inside use(); a session in use is never evicted.
  leases: number
}

export class LspPool {
  // In use order: the first entry is the least recently used.
  private readonly entries = new Map<string, PoolEntry>()
  private readonly maxSessions: number
  private readonly options: LspPoolOptions

  constructor(options: LspPoolOptions = {}) {
    this.options = options
    this.maxSessions = Math.max(1, options.maxSessions ?? resolveLspMemoryBudget().sessions)
  }

  get size(): number {
    return this.entries.size
  }

  // Runs `work` with the server for `language` in `root`, starting it when it
  // is not running.
  async use<T>(
    language: string,
    spec: LanguageServerSpec,
    root: string,
    work: (session: LspSession) => Promise<T>,
  ): Promise<T> {
    const key = `${language}\0${root}`
    const entry = this.entries.get(key) ?? this.startEntry(key, language, spec, root)
    // Re-insert so the map stays in use order.
    this.entries.delete(key)
    this.entries.set(key, entry)
    entry.leases += 1
    try {
      return await work(await entry.session)
    } finally {
      entry.leases -= 1
      this.evict()
    }
  }

  async close(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map((entry) => closeEntry(entry)))
  }

  private startEntry(
    key: string,
    language: string,
    spec: LanguageServerSpec,
    root: string,
  ): PoolEntry {
    const context = { server: language, root }
    log('Starting language server', context)
    const entry: PoolEntry = {
      context,
      leases: 0,
      session: LspSession.start(spec, root, {
        ...this.options.session,
        onStderr: (line) => log('Language server stderr', { ...context, line }),
        onExit: ({ code, signal, requested }) => {
          if (this.entries.get(key) === entry) this.entries.delete(key)
          if (!requested) logError('Language server exited', { ...context, code, signal })
        },
      }),
    }
    entry.session.catch((error: unknown) => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      logError('Language server failed to start', { ...context, error })
    })
    return entry
  }

  // Closes the least recently used idle sessions until the pool fits.
  private evict(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxSessions) return
      if (entry.leases > 0) continue
      this.entries.delete(key)
      log('Closing least recently used language server', entry.context)
      void closeEntry(entry)
    }
  }
}

async function closeEntry(entry: PoolEntry): Promise<void> {
  try {
    await (await entry.session).close()
  } catch {
    // It never started, or it is already gone.
  }
}
