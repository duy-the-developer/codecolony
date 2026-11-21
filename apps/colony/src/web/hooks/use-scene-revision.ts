import { useSyncExternalStore } from 'react'
import type { Scene } from '../scene.ts'

// Re-renders when the scene gains symbols; returns its revision.
export function useSceneRevision(scene: Scene | undefined): number {
  return useSyncExternalStore(
    (onChange) => scene?.subscribe(onChange) ?? (() => {}),
    () => scene?.revision ?? 0,
  )
}
