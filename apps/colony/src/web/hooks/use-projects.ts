import { useEffect, useState } from 'react'
import { logError } from '../../modules/logging/log.ts'
import type { ProjectSummary, ProjectsResponse } from '../../modules/wire/api-types.ts'

export function useProjects(): ProjectSummary[] {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  useEffect(() => {
    let isDisposed = false
    fetch('/api/projects')
      .then((response) => response.json() as Promise<ProjectsResponse>)
      .then((body) => {
        if (!isDisposed) setProjects(body.projects)
      })
      .catch((error: unknown) => logError('Could not load projects', { error }))
    return () => {
      isDisposed = true
    }
  }, [])
  return projects
}
