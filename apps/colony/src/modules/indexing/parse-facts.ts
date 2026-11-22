import { parseFile, textFacts } from '../language/parse.ts'
import { findAdapter, TRANSPORT_DETECTORS } from '../language/registry.ts'
import type { FileFacts } from '../world/facts.ts'

// Turns one committed blob into facts with the adapter its path selects. Runs
// on the main thread or in a parse worker (parse-pool.ts); both give the same
// facts. Never throws: a file no grammar can read still gets its size.

export async function parseFacts(path: string, bytes: Uint8Array): Promise<FileFacts> {
  const adapter = findAdapter(path)
  if (!adapter || isBinary(bytes)) return buildTextFacts(bytes)
  const source = decode(bytes)
  try {
    return await parseFile(adapter, TRANSPORT_DETECTORS, path, source)
  } catch {
    // A grammar that cannot read the file still leaves its size on the map.
    return textFacts(source)
  }
}

// Size-only facts, for files no adapter claims or no grammar could read.
export function buildTextFacts(bytes: Uint8Array): FileFacts {
  if (isBinary(bytes)) return { ...textFacts(''), language: 'binary' }
  return textFacts(decode(bytes))
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0)
}
