import { readToken } from '@codecolony/dock/web'
import type { ColonistsResponse } from '../../modules/wire/api-types.ts'

// The colonists at work, with the token the server printed: they name local
// folders and carry agents' status lines.
export async function fetchColonists(): Promise<ColonistsResponse> {
  const token = readToken()
  if (!token) throw new Error('No token: open the URL the server printed, with #token=...')
  const response = await fetch('/api/colonists', { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`/api/colonists: HTTP ${response.status}`)
  return (await response.json()) as ColonistsResponse
}
