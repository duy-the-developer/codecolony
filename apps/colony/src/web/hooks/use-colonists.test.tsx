// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Colonist, ColonistsResponse } from '../../modules/wire/api-types.ts'
import { useColonists } from './use-colonists.ts'

const page = vi.hoisted(() => ({ token: 'token' as string | undefined }))
const logError = vi.hoisted(() => vi.fn())
vi.mock('@codecolony/dock/web', () => ({ readToken: () => page.token }))
vi.mock('../../modules/logging/log.ts', () => ({ logError }))

// The browser's EventSource, driven by hand: the test sends events and drops
// the stream the way a browser that gave up would.
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static opened: FakeEventSource[] = []
  readyState = FakeEventSource.OPEN
  readonly url: string
  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.opened.push(this)
  }
  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }
  send(type: string): void {
    this.dispatchEvent(new Event(type))
  }
  giveUp(): void {
    this.readyState = FakeEventSource.CLOSED
    this.dispatchEvent(new Event('error'))
  }
}

function colonist(id: string, status: Colonist['status']): Colonist {
  return {
    id,
    repoId: 'r',
    label: id,
    status,
    session: 'firstmate',
    copy: id,
    head: 'abc1234',
    base: 'main',
    changes: [{ path: 'a.ts', kind: 'modified', units: 1 }],
    omitted: 0,
  }
}

// What the server answers at /api/colonists; tests change it between events.
let served: { status: number; body?: ColonistsResponse }

const latest = () => FakeEventSource.opened.at(-1) as FakeEventSource

describe('useColonists', () => {
  beforeEach(() => {
    page.token = 'token'
    logError.mockReset()
    FakeEventSource.opened = []
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(served.body ?? {}), { status: served.status })),
    )
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows colonists added and changed after the page loaded, without a reload', async () => {
    served = { status: 200, body: { version: 1, colonists: [colonist('a', 'waiting')] } }
    const { result } = renderHook(() => useColonists())
    act(() => latest().send('colonists'))
    await waitFor(() => expect(result.current.colonists).toEqual([colonist('a', 'waiting')]))

    served = {
      status: 200,
      body: { version: 2, colonists: [colonist('a', 'pr-ready'), colonist('b', 'working')] },
    }
    act(() => latest().send('colonists'))
    await waitFor(() =>
      expect(result.current.colonists).toEqual([
        colonist('a', 'pr-ready'),
        colonist('b', 'working'),
      ]),
    )

    served = { status: 200, body: { version: 3, colonists: [colonist('b', 'working')] } }
    act(() => latest().send('colonists'))
    await waitFor(() => expect(result.current.colonists).toEqual([colonist('b', 'working')]))
    expect(FakeEventSource.opened).toHaveLength(1)
  })

  it('opens a new stream when the browser gives up on the old one, and catches up', async () => {
    served = { status: 200, body: { version: 1, colonists: [colonist('a', 'waiting')] } }
    const { result } = renderHook(() => useColonists())
    act(() => latest().send('colonists'))
    await waitFor(() => expect(result.current.colonists).toHaveLength(1))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = latest()
    act(() => first.giveUp())
    served = { status: 200, body: { version: 2, colonists: [colonist('a', 'pr-ready')] } }
    act(() => vi.advanceTimersByTime(2000))
    expect(FakeEventSource.opened).toHaveLength(2)
    vi.useRealTimers()
    // Connecting sends the current version, which loads what was missed.
    act(() => latest().send('colonists'))
    await waitFor(() => expect(result.current.colonists).toEqual([colonist('a', 'pr-ready')]))
  })

  it('says the token was rejected, and shows no stale colonists, on a 401', async () => {
    served = { status: 200, body: { version: 1, colonists: [colonist('a', 'waiting')] } }
    const { result } = renderHook(() => useColonists())
    act(() => latest().send('colonists'))
    await waitFor(() => expect(result.current.colonists).toHaveLength(1))

    served = { status: 401 }
    act(() => latest().send('colonists'))
    await waitFor(() =>
      expect(result.current).toEqual({
        colonists: [],
        notice: 'Colonists unavailable: access token rejected. Reopen the app link.',
      }),
    )
  })

  it('only logs the failed load, with no notice, when the page has no token', async () => {
    page.token = undefined
    served = { status: 200, body: { version: 1, colonists: [colonist('a', 'waiting')] } }
    const { result } = renderHook(() => useColonists())
    act(() => latest().send('colonists'))
    await waitFor(() =>
      expect(logError).toHaveBeenCalledWith('Could not load the colonists', expect.anything()),
    )
    expect(result.current).toEqual({ colonists: [] })
  })
})
