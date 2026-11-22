import { describe, expect, it } from 'vitest'
import { createHerdrSessions } from './herdr-sessions.ts'

describe('createHerdrSessions', () => {
  it('turns Herdr agents into sessions with their folder, status and pane', async () => {
    const herdr = {
      request: (method: string) =>
        Promise.resolve(
          method === 'agent.list'
            ? {
                type: 'agent_list',
                agents: [
                  { pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', cwd: '/work/a' },
                  { pane_id: 'w1:p2', agent: 'codex', agent_status: 'blocked', cwd: '/work/b' },
                  { pane_id: 'w1:p3', agent_status: 'idle', cwd: '/work/c' },
                  { pane_id: 'w1:p4', agent_status: 'working' },
                ],
              }
            : null,
        ),
    }
    expect(await createHerdrSessions(herdr).listSessions()).toEqual([
      { cwd: '/work/a', agent: 'claude', status: 'working', paneId: 'w1:p1' },
      { cwd: '/work/b', agent: 'codex', status: 'waiting', paneId: 'w1:p2' },
      { cwd: '/work/c', status: 'paused', paneId: 'w1:p3' },
    ])
  })
})
