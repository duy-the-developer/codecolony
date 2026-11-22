import type { BuildQueueResponse, OrderChangesResponse } from '../../modules/wire/api-types.ts'

// The page's requests for the build queue, read from the server's firstmate
// home.

export async function fetchBuildQueue(signal?: AbortSignal): Promise<BuildQueueResponse> {
  const response = await fetch('/api/build-queue', signal ? { signal } : {})
  if (!response.ok) throw new Error(`build queue: HTTP ${response.status}`)
  return (await response.json()) as BuildQueueResponse
}

// The files an order's worker changed, or undefined when it has no copy.
export async function fetchOrderChanges(id: string): Promise<OrderChangesResponse | undefined> {
  const response = await fetch(`/api/build-queue/changes?id=${encodeURIComponent(id)}`)
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`order changes: HTTP ${response.status}`)
  return (await response.json()) as OrderChangesResponse
}
