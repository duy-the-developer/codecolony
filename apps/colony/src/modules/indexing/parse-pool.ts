import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { FileFacts } from '../world/facts.ts'

// Parses files on worker threads (parse-worker.ts), one file per worker at a
// time. Tree-sitter parsing is most of a cold index and runs synchronously, so
// the pool spreads it over the cores and keeps the main thread free to serve
// the map. Workers start as files arrive and stop once the pool has been idle
// for a while, so a server that is only polling holds no parser memory.

export interface ParseRequest {
  path: string
  bytes: Uint8Array
}

export type ParseResponse = { facts: FileFacts } | { error: string }

export interface ParsePoolOptions {
  // Most workers at once; defaults to the number of cores.
  size?: number
  // Idle time after which every worker stops.
  idleMs?: number
}

export interface ParsePoolHandle {
  // Same facts as parseFacts(path, bytes) on the main thread.
  parse(path: string, bytes: Uint8Array): Promise<FileFacts>
  close(): Promise<void>
}

export type ParsePoolErrorCode = 'WorkerExited' | 'WorkerFailed' | 'Closed'

export class ParsePoolError extends Error {
  override name = 'ParsePoolError'
  readonly code: ParsePoolErrorCode
  constructor(code: ParsePoolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

const WORKER_URL = new URL('./parse-worker.ts', import.meta.url)
const IDLE_MS = 10_000

interface Task extends ParseRequest {
  resolve(facts: FileFacts): void
  reject(error: ParsePoolError): void
}

interface Slot {
  worker: Worker
  task: Task | undefined
  error: unknown
}

export function createParsePool(options: ParsePoolOptions = {}): ParsePoolHandle {
  const size = Math.max(1, options.size ?? availableParallelism())
  const idleMs = options.idleMs ?? IDLE_MS
  const queue: Task[] = []
  const slots = new Set<Slot>()
  let idleTimer: NodeJS.Timeout | undefined
  let closed = false

  function spawn(): Slot {
    const slot: Slot = { worker: new Worker(WORKER_URL), task: undefined, error: undefined }
    slot.worker.on('message', (response: ParseResponse) => {
      const task = slot.task
      slot.task = undefined
      slot.worker.unref()
      if (task) {
        if ('facts' in response) task.resolve(response.facts)
        else task.reject(new ParsePoolError('WorkerFailed', `${task.path}: ${response.error}`))
      }
      dispatch()
    })
    slot.worker.on('error', (error) => {
      slot.error = error
    })
    slot.worker.on('exit', (code) => {
      slots.delete(slot)
      const task = slot.task
      slot.task = undefined
      if (task && !closed) {
        task.reject(
          new ParsePoolError('WorkerExited', `${task.path}: parse worker exited (${code})`, {
            cause: slot.error,
          }),
        )
      }
      dispatch()
    })
    slots.add(slot)
    return slot
  }

  function dispatch(): void {
    if (closed) return
    for (const slot of slots) {
      if (slot.task) continue
      const task = queue.shift()
      if (!task) break
      send(slot, task)
    }
    while (queue.length > 0 && slots.size < size) {
      const task = queue.shift()
      if (task) send(spawn(), task)
    }
    scheduleIdle()
  }

  function send(slot: Slot, task: Task): void {
    slot.task = task
    slot.worker.ref()
    // Blobs are views into git's read buffer: copy just this file and hand the
    // copy over instead of cloning the whole buffer.
    const bytes = new Uint8Array(task.bytes)
    slot.worker.postMessage({ path: task.path, bytes } satisfies ParseRequest, [bytes.buffer])
  }

  function scheduleIdle(): void {
    clearTimeout(idleTimer)
    idleTimer = undefined
    if (queue.length > 0 || [...slots].some((slot) => slot.task)) return
    idleTimer = setTimeout(() => {
      // Forget the workers first, so no new file is sent to one that is stopping.
      const stopping = [...slots]
      slots.clear()
      for (const slot of stopping) void slot.worker.terminate()
    }, idleMs)
    idleTimer.unref()
  }

  return {
    parse(path, bytes) {
      if (closed) return Promise.reject(new ParsePoolError('Closed', 'parse pool is closed'))
      return new Promise((resolve, reject) => {
        queue.push({ path, bytes, resolve, reject })
        dispatch()
      })
    },

    async close() {
      closed = true
      clearTimeout(idleTimer)
      const pending = [...queue.splice(0), ...[...slots].flatMap((slot) => slot.task ?? [])]
      for (const task of pending) task.reject(new ParsePoolError('Closed', 'parse pool is closed'))
      await Promise.all([...slots].map((slot) => slot.worker.terminate()))
      slots.clear()
    },
  }
}
