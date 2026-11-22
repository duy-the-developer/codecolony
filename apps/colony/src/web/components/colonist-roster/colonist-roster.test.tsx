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
})
