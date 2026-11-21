import type { SearchMatches } from '../shared/api-types.ts'
import { WorldDecodeError, type WorldState, worldFromResponse } from '../shared/world-decoder.ts'
import type { SymbolsResponse, WorldResponse } from '../shared/world-types.ts'

// The page's requests for world data. The map's shape comes whole once and
// as patches after that; symbols come per file; search runs on the server.

// The world now: a patch on top of `base` when the server still knows it.
export async function fetchWorld(base?: WorldState): Promise<WorldState> {
  const query = base
    ? `?session=${encodeURIComponent(base.session)}&since=${base.world.version}`
    : ''
  const response = (await fetchJson(`/api/world${query}`)) as WorldResponse
  try {
    return worldFromResponse(response, base)
  } catch (error) {
    if (!(error instanceof WorldDecodeError)) throw error
    return worldFromResponse((await fetchJson('/api/world')) as WorldResponse)
  }
}

// The symbols of files by node index, or undefined when the server has moved
// on to a newer version (the page will load that one).
export async function fetchSymbols(
  version: number,
  files: readonly number[],
): Promise<SymbolsResponse | undefined> {
  const response = await fetch(`/api/symbols?version=${version}&files=${files.join(',')}`)
  if (response.status === 409) return undefined
  if (!response.ok) throw new Error(`symbols: HTTP ${response.status}`)
  return (await response.json()) as SymbolsResponse
}

export async function fetchSearchMatches(query: string, limit: number): Promise<SearchMatches> {
  return (await fetchJson(
    `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  )) as SearchMatches
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}
