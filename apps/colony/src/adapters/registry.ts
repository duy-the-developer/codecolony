import { extname } from 'node:path'
import type { LanguageAdapter, TransportDetector } from '../core/language-adapter.ts'
import { typescriptAdapter } from './typescript/adapter.ts'
import { typescriptHttpDetector } from './typescript/http-detector.ts'

// The registry: every language adapter and transport detector Code Colony
// ships. Adding a language is one entry here plus its folder.

export const LANGUAGE_ADAPTERS: readonly LanguageAdapter[] = [typescriptAdapter]

export const TRANSPORT_DETECTORS: readonly TransportDetector[] = [typescriptHttpDetector]

const byExtension = new Map<string, LanguageAdapter>()
for (const adapter of LANGUAGE_ADAPTERS) {
  for (const ext of adapter.extensions) {
    const taken = byExtension.get(ext)
    if (taken) throw new Error(`${ext} is claimed by both ${taken.id} and ${adapter.id}`)
    byExtension.set(ext, adapter)
  }
}

export function findAdapter(path: string): LanguageAdapter | undefined {
  return byExtension.get(extname(path))
}

// Changes when any adapter or detector changes, so cached facts are re-read.
export const RULES_VERSION = [...LANGUAGE_ADAPTERS, ...TRANSPORT_DETECTORS]
  .map(({ id, version }) => `${id}@${version}`)
  .join(',')
