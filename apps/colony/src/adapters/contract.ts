import type { SymbolKind, TransportKind } from '../core/model.ts'
import { typescriptSample } from './typescript/sample.ts'

// The adapter contract: every language adapter ships a sample repository and
// the facts it must find there. contract.test.ts indexes each sample end to
// end (git, tree-sitter, world edges and, when the adapter has one, the
// language server) and checks every expectation. Paths are repository
// relative; symbol references are `path#Container.name`.

export interface AdapterSample {
  files: Record<string, string>
  symbols: {
    path: string
    name: string
    kind: SymbolKind
    container?: string
    exported?: boolean
    // Expected [first, last] line.
    lines?: [number, number]
    // Expected branch count.
    complexity?: number
  }[]
  // Import edges resolved inside the repository.
  imports: { from: string; to: string; typeOnly?: boolean }[]
  // Call edges the parser side resolves (provenance tree-sitter).
  calls: { from: string; to: string }[]
  // Call edges the language server proves (provenance lsp). Required when
  // the adapter has a language server.
  semanticCalls?: { from: string; to: string }[]
  transports?: { path: string; kind: TransportKind; target: string }[]
  // HTTP edges from client file to route file.
  http?: { from: string; to: string }[]
}

// One sample per adapter id.
export const CONTRACT_SAMPLES: Record<string, AdapterSample> = {
  typescript: typescriptSample,
}
