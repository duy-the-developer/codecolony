// Shapes shared by the server's /api routes and the page.

// repo: one git repository; repos: a folder whose children are repositories;
// monorepo: one repository with workspace packages.
export const PROJECT_KINDS = ['repo', 'repos', 'monorepo'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]

export interface ProjectSummary {
  name: string
  kind: ProjectKind
}

export interface ProjectsResponse {
  projects: ProjectSummary[]
}

// GET /api/file?id=<file id>: a file's text at the commit its repository was
// indexed at. Binary files come back without text.
export interface FileResponse {
  id: string
  path: string
  commit: string | undefined
  isBinary: boolean
  text: string
}
