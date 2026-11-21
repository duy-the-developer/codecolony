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
