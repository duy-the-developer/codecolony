import { type DockHandle, type DockWorker, mountDock, readToken } from '@codecolony/dock/web'
import { useEffect, useState } from 'react'

export interface DockState {
  dock: DockHandle | undefined
  workers: DockWorker[]
}

// Mounts the terminal dock into an element for as long as it exists.
export function useDock(element: HTMLElement | null): DockState {
  const [state, setState] = useState<DockState>({ dock: undefined, workers: [] })
  useEffect(() => {
    if (!element) return
    const dock = mountDock(element, { token: readToken() })
    setState({ dock, workers: [] })
    const unsubscribe = dock.onWorkers((workers) => setState({ dock, workers }))
    return () => {
      unsubscribe()
      dock.dispose()
      setState({ dock: undefined, workers: [] })
    }
  }, [element])
  return state
}
