import type { SearchEntry, SearchMatches } from '../wire/api-types.ts'
import type { World } from '../world/world-types.ts'

// File and symbol names from the world, for the ⌘K search (/api/search). The
// page does not hold every symbol, so it searches here.

interface IndexedEntry {
  entry: SearchEntry
  name: string
  path: string
}

export interface SearchIndex {
  entries: readonly IndexedEntry[]
}

export function buildSearchIndex(world: World): SearchIndex {
  const entries: IndexedEntry[] = []
  for (const node of world.nodes) {
    if (node.kind !== 'file' && node.kind !== 'symbol') continue
    const path = node.path ?? node.name
    const entry: SearchEntry = {
      id: node.id,
      kind: node.kind,
      name: node.name,
      path,
      lines: node.lines,
    }
    if (node.symbolKind) entry.symbolKind = node.symbolKind
    if (node.range) entry.line = node.range.start
    entries.push({ entry, name: node.name.toLowerCase(), path: path.toLowerCase() })
  }
  return { entries }
}

// Ranks names that equal the query, then start with it, then contain it; a
// file also matches on its path. Shorter names win ties.
export function listSearchMatches(index: SearchIndex, query: string, limit: number): SearchMatches {
  const q = query.trim().toLowerCase()
  if (!q) return { symbols: [], files: [] }
  const scored: { entry: SearchEntry; score: number }[] = []
  for (const item of index.entries) {
    const score = matchScore(item, q)
    if (score !== undefined) scored.push({ entry: item.entry, score })
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.path.localeCompare(b.entry.path),
  )
  const symbols: SearchEntry[] = []
  const files: SearchEntry[] = []
  for (const { entry } of scored) {
    const list = entry.kind === 'symbol' ? symbols : files
    if (list.length < limit) list.push(entry)
  }
  return { symbols, files }
}

function matchScore(item: IndexedEntry, q: string): number | undefined {
  if (item.name === q) return 0
  if (item.name.startsWith(q)) return 1
  if (item.name.includes(q)) return 2
  if (item.entry.kind === 'file' && item.path.includes(q)) return 3
  return undefined
}
