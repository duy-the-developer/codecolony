import { parentPort } from 'node:worker_threads'
import { parseFacts } from './parse-facts.ts'
import type { ParseRequest, ParseResponse } from './parse-pool.ts'

// Entry point of one parse worker thread (see parse-pool.ts): parses one file
// per request, in the order the requests arrive.

const port = parentPort
if (!port) throw new Error('parse-worker.ts runs only as a worker thread')

port.on('message', ({ path, bytes }: ParseRequest) => {
  parseFacts(path, bytes).then(
    (facts) => port.postMessage({ facts } satisfies ParseResponse),
    (error: unknown) => port.postMessage({ error: String(error) } satisfies ParseResponse),
  )
})
