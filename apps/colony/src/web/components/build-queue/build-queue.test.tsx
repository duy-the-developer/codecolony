// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHELL_PREFERENCES } from '../../../modules/preferences/shell-preferences.ts'
import type { BuildOrder, BuildQueueResponse } from '../../../modules/wire/api-types.ts'
import { BuildQueue, type BuildQueueProps } from './build-queue.tsx'

const PR = 'https://github.com/acme/app/pull/64'

function order(id: string, change: Partial<BuildOrder> = {}): BuildOrder {
  return {
    id,
    title: `Title of ${id}`,
    section: 'active',
    state: 'working',
    project: 'app',
    hasWorktree: false,
    ...change,
  }
}

const QUEUE: BuildQueueResponse = {
  isConnected: true,
  orders: [
    order('decide', { state: 'waiting', kind: 'captain', note: 'Your decision' }),
    order('review', { state: 'pr-ready', colonist: 'review', pullRequestUrl: PR }),
    order('build', { colonist: 'build', hasWorktree: true, note: 'tests pass' }),
    order('later', { section: 'queued', state: 'queued', note: 'Held until Monday' }),
    order('shipped', {
      section: 'done',
      state: 'done',
      date: '2026-11-22',
      pullRequestUrl: 'https://github.com/acme/app/pull/63',
    }),
  ],
}

function renderQueue(props: Partial<BuildQueueProps> = {}) {
  const handlers = {
    onToggleSection: vi.fn(),
    onShowOnMap: vi.fn(() => Promise.resolve(true)),
  }
  render(
    <BuildQueue
      queue={QUEUE}
      scope="app"
      openSections={DEFAULT_SHELL_PREFERENCES.openQueueSections}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

function section(title: string): HTMLElement {
  const header = screen.getByRole('button', { name: new RegExp(`^${title}`) })
  const element = header.closest('section')
  if (!element) throw new Error(title)
  return element
}

describe('BuildQueue', () => {
  afterEach(cleanup)

  it('counts open orders and keeps the place-an-order button disabled', () => {
    renderQueue()
    expect(screen.getByText('app · 4 open orders')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Order' })).toHaveProperty('disabled', true)
  })

  it('shows Active and Queued open and Done closed by default, with counts', () => {
    renderQueue()
    expect(section('Active').querySelector('ol')?.children).toHaveLength(3)
    expect(section('Queued').querySelector('ol')?.children).toHaveLength(1)
    expect(section('Done').querySelector('ol')).toBeNull()
    expect(within(section('Done')).getByText('1')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Done/ }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('toggles a section through its header', () => {
    const { onToggleSection } = renderQueue()
    fireEvent.click(screen.getByRole('button', { name: /^Done/ }))
    expect(onToggleSection).toHaveBeenCalledWith('done')
  })

  it('shows each card with its state, colonist, note and actions', () => {
    renderQueue({ openSections: { active: true, queued: true, done: true } })
    const active = within(section('Active'))
    expect(active.getByText('waiting on you')).toBeTruthy()
    expect(active.getByText('captain')).toBeTruthy()
    expect(active.getByText('PR ready')).toBeTruthy()
    expect(active.getByRole('link', { name: 'Review PR' }).getAttribute('href')).toBe(PR)
    expect(active.getByText('build')).toBeTruthy()
    expect(active.getByText('tests pass')).toBeTruthy()
    expect(active.getAllByRole('button', { name: 'Show on map' })).toHaveLength(1)
    expect(within(section('Queued')).getByText('Held until Monday')).toBeTruthy()
    const done = within(section('Done'))
    expect(done.getByRole('link', { name: 'PR #63' })).toBeTruthy()
    expect(done.getByText('2026-11-22')).toBeTruthy()
  })

  it('asks the map to show an order, and says when there is nothing to show', async () => {
    const onShowOnMap = vi.fn(() => Promise.resolve(false))
    renderQueue({ onShowOnMap })
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))
    expect(onShowOnMap).toHaveBeenCalledWith(expect.objectContaining({ id: 'build' }))
    await waitFor(() => expect(screen.getByText('No file changes on the map yet.')).toBeTruthy())
  })

  it('logs a failed show on map instead of claiming there are no changes', async () => {
    const error = new Error('502')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onShowOnMap = vi.fn(() => Promise.reject(error))
    renderQueue({ onShowOnMap })
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Show on map failed', error))
    expect(screen.queryByText('No file changes on the map yet.')).toBeNull()
    consoleError.mockRestore()
  })

  it('says it is not connected without a firstmate home', () => {
    renderQueue({ queue: { isConnected: false } })
    expect(screen.getByText(/Not connected to firstmate/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Active/ })).toBeNull()
  })
})
