import type { LiveSession, SessionSource, SessionStatus } from './session-source.ts'

// Sessions from Herdr's agent list: each agent pane's folder, status and pane
// id. Takes the dock's Herdr client, so the colony opens the socket only when
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
        if (!isRecord(agent) || typeof agent.cwd !== 'string' || agent.cwd === '') return []
        const session: LiveSession = { cwd: agent.cwd }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
