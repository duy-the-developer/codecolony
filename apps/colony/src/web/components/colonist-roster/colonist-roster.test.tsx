// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Colonist } from '../../../modules/wire/api-types.ts'
import { ColonistRoster } from './colonist-roster.tsx'

function colonist(id: string, label: string, status: Colonist['status']): Colonist {
  return {
    id,
    repoId: 'r',
    label,
    status,
    session: 'firstmate',
    copy: id,
    head: 'abc1234',
    base: 'main',
    changes: [{ path: 'a.ts', kind: 'modified', units: 1 }],
    omitted: 0,
  }
}

describe('ColonistRoster', () => {
  afterEach(cleanup)

  it('shows why the colonists are unavailable, in place of the robots', () => {
    render(
      <ColonistRoster
        colonists={[]}
        notice="Colonists unavailable: access token rejected. Reopen the app link."
        selectedId={undefined}
        onPick={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Colonists unavailable: access token rejected. Reopen the app link.',
    )
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('shows nothing without colonists', () => {
    const { container } = render(
      <ColonistRoster colonists={[]} selectedId={undefined} onPick={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('has one robot per colonist, names the picked one with its file count, and picks on click', () => {
    const onPick = vi.fn()
    render(
      <ColonistRoster
        colonists={[colonist('/a', 'build-a', 'working'), colonist('/b', 'build-b', 'waiting')]}
        selectedId="/b"
        onPick={onPick}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.title)).toEqual([
      'build-a · working · 1 file',
      'build-b · waiting on you · 1 file',
    ])
    expect(buttons.map((b) => b.textContent)).toEqual(['', 'build-b1 file'])
    fireEvent.click(buttons[0] as HTMLElement)
    expect(onPick).toHaveBeenCalledWith('/a')
  })

  it('toggles Active only and counts the colonists it hides', () => {
    const onToggleActiveOnly = vi.fn()
    render(
      <ColonistRoster
        colonists={[colonist('/a', 'build-a', 'working')]}
        hiddenCount={2}
        selectedId={undefined}
        isActiveOnly
        onPick={vi.fn()}
        onToggleActiveOnly={onToggleActiveOnly}
      />,
    )
    expect(screen.getByRole('navigation').textContent).toMatch(/^Colonists 1 · 2 hidden/)
    const toggle = screen.getByRole('button', { name: 'Active only' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(onToggleActiveOnly).toHaveBeenCalledOnce()
  })

  it('stays on the map while Active only hides every colonist', () => {
    render(
      <ColonistRoster
        colonists={[]}
        hiddenCount={3}
        selectedId={undefined}
        isActiveOnly
        onPick={vi.fn()}
        onToggleActiveOnly={vi.fn()}
      />,
    )
    expect(screen.getByRole('navigation').textContent).toBe('Colonists 0 · 3 hiddenActive only')
  })
})
