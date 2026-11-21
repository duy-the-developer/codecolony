import { findAdapter, TRANSPORT_DETECTORS } from '../adapters/registry.ts'
import type { FileFacts } from '../core/model.ts'
import { parseFile, textFacts } from '../core/parse.ts'

// Turns one committed blob into facts with the adapter its path selects. Runs
// on the main thread or in a parse worker (parse-pool.ts); both give the same
// facts. Never throws: a file no grammar can read still gets its size.

export async function parseFacts(path: string, bytes: Uint8Array): Promise<FileFacts> {
  if (isBinary(bytes)) return { ...textFacts(''), language: 'binary' }
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
  const adapter = findAdapter(path)
  if (!adapter) return textFacts(source)
  try {
    return await parseFile(adapter, TRANSPORT_DETECTORS, path, source)
  } catch {
    // A grammar that cannot read the file still leaves its size on the map.
    return textFacts(source)
  }
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0)
}
