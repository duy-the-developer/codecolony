import { useEffect, useState } from 'react'
import { logError } from '../../modules/logging/log.ts'
import type { Colonist } from '../../modules/wire/api-types.ts'
import { fetchColonists, TokenError } from '../client/colonist-client.ts'
import { subscribeServerEvent } from '../client/server-events.ts'

const NONE: Colonist[] = []

export interface ColonistsState {
  colonists: Colonist[]
  // Set when the server rejects the page's token; the map then shows no
  // colonists rather than ones that went stale.
  notice?: string
}

// The live colonists: loaded whenever the server announces a new snapshot.
export function useColonists(): ColonistsState {
  const [state, setState] = useState<ColonistsState>({ colonists: NONE })
  useEffect(() => {
    let isDisposed = false
    let queue: Promise<void> = Promise.resolve()
    async function load(): Promise<void> {
      try {
        const next = await fetchColonists()
        if (!isDisposed) setState({ colonists: next.colonists })
      } catch (error) {
        if (!(error instanceof TokenError)) throw error
        if (!isDisposed) setState({ colonists: NONE, notice: error.message })
      }
    }
    const unsubscribe = subscribeServerEvent('colonists', () => {
      queue = queue
        .then(load)
        .catch((error: unknown) => logError('Could not load the colonists', { error }))
    })
    return () => {
      isDisposed = true
      unsubscribe()
    }
  }, [])
  return state
}
