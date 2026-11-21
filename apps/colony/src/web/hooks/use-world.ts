import { useEffect, useState } from 'react'
import { logError } from '../../shared/log.ts'
import type { World } from '../../shared/world-types.ts'
import { Scene } from '../scene.ts'

// The live world: loaded whenever the server announces a new version.
export function useWorld(): Scene | undefined {
  const [scene, setScene] = useState<Scene>()
  useEffect(() => {
    let current: Scene | undefined
    let isDisposed = false
    async function loadWorld(): Promise<void> {
      const world = (await (await fetch('/api/world')).json()) as World
      if (isDisposed || (current && world.version <= current.world.version)) return
      current = new Scene(world)
      setScene(current)
    }
    const events = new EventSource('/api/events')
    events.addEventListener('world', () => {
      loadWorld().catch((error: unknown) => logError('Could not load the world', { error }))
    })
    return () => {
      isDisposed = true
      events.close()
    }
  }, [])
  return scene
}
