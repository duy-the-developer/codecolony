import { useEffect, useState } from 'react'
import { logError } from '../../modules/logging/log.ts'
import type { Colonist } from '../../modules/wire/api-types.ts'
import { fetchColonists } from '../client/colonist-client.ts'
import { subscribeServerEvent } from '../client/server-events.ts'

const NONE: Colonist[] = []

// The live colonists: loaded whenever the server announces a new snapshot.
export function useColonists(): Colonist[] {
  const [colonists, setColonists] = useState<Colonist[]>(NONE)
  useEffect(() => {
    let isDisposed = false
    let version = -1
    let queue: Promise<void> = Promise.resolve()
    async function load(): Promise<void> {
      const next = await fetchColonists()
      if (isDisposed || next.version === version) return
      version = next.version
      setColonists(next.colonists)
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
  return colonists
}
