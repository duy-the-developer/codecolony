import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHerdrApi, HerdrError } from './herdr-api.ts'
import {
  answerWorkerList,
  FAKE_AGENTS,
  type FakeHandler,
  type FakeHerdr,
  ok,
  startFakeHerdr,
} from './testing/fake-herdr.ts'

describe('createHerdrApi', () => {
  let fake: FakeHerdr | undefined

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  async function api(handler: FakeHandler, timeoutMs?: number) {
    fake = await startFakeHerdr(handler)
    return createHerdrApi(fake.socketPath, timeoutMs)
  }

  it('lists agents as workers, keeping only what the map needs', async () => {
    const herdr = await api(answerWorkerList)
    expect(await herdr.listWorkers()).toEqual([
      {
        paneId: 'w1:p1',
        workspaceId: 'w1',
        agent: 'claude',
        name: 'dock',
        label: 'codecolony-dock',
        status: 'working',
        focused: true,
      },
      {
        paneId: 'w2:p4',
        workspaceId: 'w2',
        agent: null,
        name: null,
        label: 'mystery-task',
        status: 'unknown',
        focused: false,
      },
    ])
    expect(fake?.requests.map((request) => request.method).sort()).toEqual([
      'agent.list',
      'tab.list',
      'workspace.list',
    ])
  })

  it('falls back to agent names when Herdr cannot list workspaces or tabs', async () => {
    const herdr = await api((request) =>
      request.method === 'agent.list'
        ? ok(request, { type: 'agent_list', agents: FAKE_AGENTS })
        : JSON.stringify({ id: request.id, error: { code: 'unknown_method', message: 'no' } }),
    )
    expect((await herdr.listWorkers()).map((worker) => worker.label)).toEqual(['dock', 'w2:p4'])
  })

  it('focuses a pane by id', async () => {
    const herdr = await api((request) => ok(request, { type: 'ok' }))
    await herdr.focusPane('w2:p4')
    expect(fake?.requests[0]).toMatchObject({ method: 'pane.focus', params: { pane_id: 'w2:p4' } })
  })

  it('raises Herdr errors with their code', async () => {
    const herdr = await api((request) =>
      JSON.stringify({ id: request.id, error: { code: 'pane_not_found', message: 'no pane' } }),
    )
    const error = await herdr.focusPane('w9:p9').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(HerdrError)
    expect(error).toMatchObject({ code: 'pane_not_found', message: 'no pane' })
  })

  it.each<[string, FakeHandler, RegExp]>([
    ['invalid JSON', () => '{nope', /invalid JSON/],
    ['another id', () => JSON.stringify({ id: 'other', result: {} }), /unexpected reply/],
    ['no result', (request) => JSON.stringify({ id: request.id }), /without a result/],
    ['a hang-up', () => null, /without answering/],
    [
      'the wrong shape',
      (request) => ok(request, { type: 'pane_list', panes: [] }),
      /unexpected shape/,
    ],
  ])('rejects %s', async (_, handler, message) => {
    const herdr = await api(handler)
    await expect(herdr.listWorkers()).rejects.toThrow(message)
  })

  it('reports a missing socket as unavailable', async () => {
    const herdr = createHerdrApi('/nonexistent/herdr.sock')
    await expect(herdr.listWorkers()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('times out when Herdr does not answer', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cc-herdr-')), 'silent.sock')
    const silent = createServer(() => {})
    await new Promise<void>((resolve) => silent.listen(path, resolve))
    try {
      await expect(createHerdrApi(path, 50).listWorkers()).rejects.toMatchObject({
        code: 'timeout',
      })
    } finally {
      silent.close()
    }
  })
})
