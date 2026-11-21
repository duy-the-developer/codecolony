import { fileURLToPath } from 'node:url'
import type { LanguageServerSpec } from '../core/language-adapter.ts'

// A language server spec that runs testing/fake-lsp-server as a real child
// process, so tests cover stdio, crashes and restarts end to end.

export interface FakeLspBehavior {
  // The nth call-hierarchy request (1-based) writes to stderr and exits with
  // code 134, the way tsserver dies at its heap limit.
  crashOnPrepare?: number
  // How long each call-hierarchy request waits before it answers, in order.
  prepareDelaysMs?: number[]
}

const SERVER = fileURLToPath(new URL('./fake-lsp-server/main.ts', import.meta.url))

export function createFakeLsp(behavior: FakeLspBehavior = {}): LanguageServerSpec {
  return {
    command: () => [process.execPath, SERVER, JSON.stringify(behavior)],
    languageId: () => 'typescript',
  }
}
