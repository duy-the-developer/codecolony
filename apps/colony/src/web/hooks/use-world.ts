import { useEffect, useState } from 'react'
import { logError } from '../../modules/logging/log.ts'
import { Scene } from '../../modules/scene/scene.ts'
import type { WorldState } from '../../modules/wire/world-decoder.ts'
import { fetchSymbols, fetchWorld } from '../client/world-client.ts'

// The live world: loaded whenever the server announces a new version, as a
// patch on the version the page holds.
export function useWorld(): Scene | undefined {
  const [scene, setScene] = useState<Scene>()
  useEffect(() => {
    let current: Scene | undefined
    let state: WorldState | undefined
    let isDisposed = false
    // One load at a time, so each patch applies to the version before it.
    let queue: Promise<void> = Promise.resolve()
    async function loadWorld(): Promise<void> {
      const next = await fetchWorld(state)
      if (isDisposed) return
      // Versions restart with each server session.
      if (state?.session === next.session && next.world.version <= state.world.version) return
      state = next
      current = new Scene(next.world, { state: next, fetchSymbols }, current)
      setScene(current)
    }
    const events = new EventSource('/api/events')
    events.addEventListener('world', () => {
      queue = queue
        .then(loadWorld)
        .catch((error: unknown) => logError('Could not load the world', { error }))
    })
    return () => {
      isDisposed = true
      events.close()
    }
  }, [])
  return scene
}
