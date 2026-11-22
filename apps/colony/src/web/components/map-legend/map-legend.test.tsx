// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrawnLines } from '../../../modules/map/overlays.ts'
import { MapLegend } from './map-legend.tsx'

const NOTHING: DrawnLines = { overlays: [], isDirected: false }

function groupTitles(): string[] {
  return screen.getAllByRole('heading').map((heading) => heading.textContent ?? '')
}

// Each row's name, without its swatch.
function rowNames(): string[] {
  return screen.getAllByRole('listitem').map((row) =>
    [...row.children]
      .filter((child) => !child.hasAttribute('aria-hidden'))
      .map((child) => child.textContent)
      .join(''),
  )
}

describe('MapLegend', () => {
  afterEach(cleanup)

  it('collapses to a chip that counts the groups and toggles on click', () => {
    const onToggle = vi.fn()
    render(<MapLegend lines={NOTHING} isOpen={false} onToggle={onToggle} />)
    const toggle = screen.getByRole('button', { name: /Legend/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('· 2')
    expect(screen.queryAllByRole('listitem')).toEqual([])
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('lists only the always-on entries with no lines drawn', () => {
    render(<MapLegend lines={NOTHING} isOpen onToggle={() => {}} />)
    expect(groupTitles()).toEqual(['Colonists', 'Changes'])
    expect(rowNames()).toEqual([
      'Pin',
      'Possible conflict',
      'Modified',
      'AddedPlaceholder, sized by line count',
      'Removed',
      'Selected',
    ])
  })

  it('adds an overlay group while its lines are drawn', () => {
    render(
      <MapLegend
        lines={{ overlays: ['dependency'], isDirected: false }}
        isOpen
        onToggle={() => {}}
      />,
    )
    expect(groupTitles()).toEqual(['Colonists', 'Changes', 'Dependency'])
    expect(rowNames().at(-1)).toBe('Import')
  })

  it('shows both directions while a selection draws its lines, with no overlay on', () => {
    render(<MapLegend lines={{ overlays: [], isDirected: true }} isOpen onToggle={() => {}} />)
    expect(groupTitles()).toEqual(['Colonists', 'Changes', 'Dependency'])
    expect(rowNames().slice(-2)).toEqual(['Depends on', 'Dependants'])
  })
})
