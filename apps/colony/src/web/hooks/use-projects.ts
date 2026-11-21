import { useEffect, useState } from 'react'
import type { ProjectSummary, ProjectsResponse } from '../../shared/api-types.ts'
import { logError } from '../../shared/log.ts'

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
