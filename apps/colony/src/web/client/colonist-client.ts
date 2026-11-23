import { readToken } from '@codecolony/dock/web'
import type { ColonistsResponse } from '../../modules/wire/api-types.ts'

// The page holds no token the server takes: none at all, or one from an
// earlier server run (each run prints a fresh one). Only opening the URL the
// server printed helps, so the page says so instead of retrying.
export class TokenError extends Error {
  override name = 'TokenError'
}

// The colonists at work, with the token the server printed: they name local
// folders and carry agents' status lines.
export async function fetchColonists(): Promise<ColonistsResponse> {
  const token = readToken()
  if (!token) throw new TokenError('No token: open the URL the server printed, with #token=...')
  const response = await fetch('/api/colonists', { headers: { authorization: `Bearer ${token}` } })
  if (response.status === 401) {
    throw new TokenError('The server restarted with a new token: open the URL it printed')
  }
  if (!response.ok) throw new Error(`/api/colonists: HTTP ${response.status}`)
  return (await response.json()) as ColonistsResponse
}
