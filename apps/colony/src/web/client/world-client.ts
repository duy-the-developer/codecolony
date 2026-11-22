import type { SearchMatches } from '../../modules/wire/api-types.ts'
import {
  WorldDecodeError,
  type WorldState,
  worldFromResponse,
} from '../../modules/wire/world-decoder.ts'
import type { SymbolsResponse, WorldResponse } from '../../modules/world/world-types.ts'

// The page's requests for world data. The map's shape comes whole once and
// as patches after that; symbols come per file; search runs on the server.

// The world now: a patch on top of `base` when the server still knows it.
// Every request carries the window's shape, which a freshly laid out map
// takes for its top level.
export async function fetchWorld(base?: WorldState): Promise<WorldState> {
  const whole = `/api/world?aspect=${window.innerWidth / window.innerHeight}`
  const url = base
    ? `${whole}&session=${encodeURIComponent(base.session)}&since=${base.world.version}`
    : whole
  const response = (await fetchJson(url)) as WorldResponse
  try {
    return worldFromResponse(response, base)
  } catch (error) {
    if (!(error instanceof WorldDecodeError)) throw error
    return worldFromResponse((await fetchJson(whole)) as WorldResponse)
  }
}

// The symbols of files by node index, or undefined when the server has moved
// on from this session or version (the page will load the new one).
export async function fetchSymbols(
  session: string,
  version: number,
  files: readonly number[],
): Promise<SymbolsResponse | undefined> {
  const response = await fetch(
    `/api/symbols?session=${encodeURIComponent(session)}&version=${version}&files=${files.join(',')}`,
  )
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
