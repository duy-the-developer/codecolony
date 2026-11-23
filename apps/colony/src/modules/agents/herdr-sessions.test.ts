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

  it('places a pane in the folder its agent works in, not the one the pane opened in', async () => {
    const herdr = {
      request: () =>
        Promise.resolve({
          type: 'agent_list',
          agents: [
            {
              pane_id: 'w92:p2',
              agent: 'claude',
              agent_status: 'working',
              cwd: '/p/repo',
              foreground_cwd: '/slots/8/repo',
            },
            { pane_id: 'w92:p3', agent_status: 'idle', cwd: '/p/repo', foreground_cwd: '' },
          ],
        }),
    }
    expect(await createHerdrSessions(herdr).listSessions()).toEqual([
      { cwd: '/slots/8/repo', agent: 'claude', status: 'working', paneId: 'w92:p2' },
      { cwd: '/p/repo', status: 'paused', paneId: 'w92:p3' },
    ])
  })
})
