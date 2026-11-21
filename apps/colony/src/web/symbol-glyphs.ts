import type { SymbolKind } from '../shared/world-types.ts'

// One-letter badges for symbol kinds, in search results and the File tab.
export const SYMBOL_GLYPHS: Record<SymbolKind, string> = {
  function: 'ƒ',
  method: 'ƒ',
  class: 'C',
  interface: 'T',
  type: 'T',
  enum: 'E',
  variable: 'v',
  namespace: 'N',
}
