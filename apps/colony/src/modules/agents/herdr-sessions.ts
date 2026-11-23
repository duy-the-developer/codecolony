import type { LiveSession, SessionSource, SessionStatus } from './session-source.ts'

// Sessions from Herdr's agent list: each agent pane's folder, status and pane
// id. The folder is where the pane's agent works (`foreground_cwd`), which
// differs from the one the pane opened in (`cwd`) when, say, a pane opened in
// a clone runs an agent in one of its worktrees. Takes the dock's Herdr client, so the colony opens the socket only when
// the dock may (never with --no-herdr).

export interface HerdrRequester {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
}

const STATUS_FROM_HERDR: Record<string, SessionStatus> = {
  working: 'working',
  blocked: 'waiting',
  idle: 'paused',
  done: 'paused',
}

export function createHerdrSessions(herdr: HerdrRequester): SessionSource {
  return {
    name: 'herdr',
    async listSessions() {
      const result = await herdr.request('agent.list')
      if (!isRecord(result) || !Array.isArray(result.agents)) return []
      return result.agents.flatMap((agent): LiveSession[] => {
        if (!isRecord(agent)) return []
        const cwd = nonEmpty(agent.foreground_cwd) ?? nonEmpty(agent.cwd)
        if (!cwd) return []
        const session: LiveSession = { cwd }
        if (typeof agent.agent === 'string') session.agent = agent.agent
        const status =
          typeof agent.agent_status === 'string' ? STATUS_FROM_HERDR[agent.agent_status] : undefined
        if (status) session.status = status
        if (typeof agent.pane_id === 'string') session.paneId = agent.pane_id
        return [session]
      })
    },
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
