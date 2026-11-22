// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlacedColonist } from '../../../modules/scene/colonist-places.ts'
import { ColonistCard } from './colonist-card.tsx'

const PLACED: PlacedColonist = {
  colonist: {
    id: '/slots/2/repo',
    repoId: 'r',
    label: 'colonists-build',
    status: 'pr-ready',
    note: 'done: PR open',
    task: 'colonists-build',
    session: 'firstmate',
    agent: 'claude',
    copy: '~/slots/2/repo',
    branch: 'fm/colonists-build',
    head: 'abc1234',
    base: 'production',
    pr: 'https://github.com/o/r/pull/9',
    paneId: 'w1:p2',
    changes: [
      { path: 'apps/colony/src/web/render.ts', kind: 'modified', units: 1 },
      { path: 'src/new.ts', kind: 'added', units: 1 },
      { path: 'old.ts', kind: 'removed', units: 1 },
    ],
    omitted: 0,
  },
  initials: 'CB',
  changes: [
    {
      path: 'apps/colony/src/web/render.ts',
      kind: 'modified',
      nodeId: 'r/apps/colony/src/web/render.ts',
    },
    {
      path: 'src/new.ts',
      kind: 'added',
      holderId: 'r/src',
      placeholder: { x: 0, y: 0, w: 1, h: 1 },
    },
    { path: 'old.ts', kind: 'removed' },
  ],
  folders: [],
}

describe('ColonistCard', () => {
  afterEach(cleanup)

  it('shows who the colonist is, its pull request and every file in its diff', () => {
    render(
      <ColonistCard
        placed={PLACED}
        canOpenTerminal={false}
        onClose={vi.fn()}
        onOpenTerminal={vi.fn()}
        onPick={vi.fn()}
      />,
    )
    expect(screen.getByText('● PR ready')).toBeTruthy()
    expect(screen.getByText('done: PR open')).toBeTruthy()
    expect(screen.getByText('firstmate worker · claude')).toBeTruthy()
    expect(screen.getByText('1 modified · 1 added · 1 removed')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Show PR' }).getAttribute('href')).toBe(
      'https://github.com/o/r/pull/9',
    )
    expect(screen.getByText('…/src/web/render.ts')).toBeTruthy()
    expect(screen.getAllByText('placeholder')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Open terminal' })).toHaveProperty('disabled', true)
  })

  it('picks a changed file on the map and opens the terminal on its pane', () => {
    const onPick = vi.fn()
    const onOpenTerminal = vi.fn()
    render(
      <ColonistCard
        placed={PLACED}
        canOpenTerminal
        onClose={vi.fn()}
        onOpenTerminal={onOpenTerminal}
        onPick={onPick}
      />,
    )
    fireEvent.click(screen.getByText('…/src/web/render.ts'))
    expect(onPick).toHaveBeenCalledWith('r/apps/colony/src/web/render.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    expect(onOpenTerminal).toHaveBeenCalledWith('w1:p2')
  })
})
