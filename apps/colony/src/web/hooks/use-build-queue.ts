import { useEffect, useState } from 'react'
import { logError } from '../../modules/logging/log.ts'
import type { BuildQueueResponse } from '../../modules/wire/api-types.ts'
import { fetchBuildQueue } from '../client/build-queue-client.ts'

// Workers append to their status files and firstmate edits the backlog all
// the time; a few seconds behind is close enough for a glance.
const POLL_MS = 5000

// The build queue, kept fresh while the page is visible. Undefined until the
// first answer; a failed refresh keeps the last one.
export function useBuildQueue(): BuildQueueResponse | undefined {
  const [queue, setQueue] = useState<BuildQueueResponse>()
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let hasFailed = false
    let isLoading = false
    const refresh = async () => {
      clearTimeout(timer)
      if (isLoading) return
      isLoading = true
      try {
        const next = await fetchBuildQueue(controller.signal)
        hasFailed = false
        setQueue((current) => (sameJson(current, next) ? current : next))
      } catch (error) {
        if (controller.signal.aborted) return
        if (!hasFailed) logError('Could not load the build queue', { error })
        hasFailed = true
      } finally {
        isLoading = false
      }
      if (!controller.signal.aborted && document.visibilityState === 'visible') {
        timer = setTimeout(refresh, POLL_MS)
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
      else clearTimeout(timer)
    }
    void refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
  return queue
}

// Unchanged polls keep the same object, so the panel does not re-render.
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
