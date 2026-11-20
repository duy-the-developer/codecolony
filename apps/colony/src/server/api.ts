import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProjectsResponse } from '../shared/api.ts'
import type { ColonyConfig } from './config.ts'

// Answers /api/* and returns true, or returns false to let the page handle it.
export function createApi(config: ColonyConfig) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (!pathname.startsWith('/api/')) return false
    if (req.method === 'GET' && pathname === '/api/projects') {
      const body: ProjectsResponse = {
        projects: config.projects.map(({ name, kind }) => ({ name, kind })),
      }
      json(res, 200, body)
    } else {
      json(res, 404, { error: 'not found' })
    }
    return true
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
