// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrawnLines, OverlayId } from '../../../modules/map/overlays.ts'
import { MapLegend, type MapLegendProps } from './map-legend.tsx'

const NOTHING: DrawnLines = { overlays: [], isDirected: false, isSelected: false }

function renderLegend(props: Partial<MapLegendProps> = {}) {
  return render(
    <MapLegend
      lines={NOTHING}
      overlays={new Set<OverlayId>()}
      hasColonists={false}
      isColonistPicked={false}
      hasConflicts={false}
      isOpen
      onToggle={() => {}}
      {...props}
    />,
  )
}

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
    renderLegend({ hasColonists: true, isOpen: false, onToggle })
    const toggle = screen.getByRole('button', { name: /Legend/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('· 1')
    expect(screen.queryAllByRole('listitem')).toEqual([])
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('is empty with nothing on the map', () => {
    renderLegend()
    expect(screen.queryAllByRole('heading')).toEqual([])
  })

  it('names the robots, and the conflict badge only while there is one', () => {
    renderLegend({ hasColonists: true })
    expect(groupTitles()).toEqual(['Colonists'])
    expect(rowNames()).toEqual(['ColonistOn the file it saved last'])
    cleanup()
    renderLegend({ hasColonists: true, hasConflicts: true })
    expect(rowNames()).toEqual(['ColonistOn the file it saved last', 'Possible conflict'])
  })

  it('adds the Git and Owners groups with their keys while they are on', () => {
    renderLegend({ hasColonists: true, overlays: new Set<OverlayId>(['git', 'owners']) })
    expect(groupTitles()).toEqual(['Colonists', 'Git2', 'Owners3'])
    expect(rowNames().slice(1)).toEqual([
      'Modified',
      'AddedPlaceholder, sized by line count',
      'Removed',
      "OwnerA pin per changed file, in its colonist's colour",
    ])
  })

  it("shows the picked colonist's changes with the Git overlay off", () => {
    renderLegend({ hasColonists: true, isColonistPicked: true })
    expect(groupTitles()).toEqual(['Colonists', 'Git · picked colonist2'])
  })

  it('adds the Dependency group while its lines are drawn', () => {
    renderLegend({ lines: { overlays: ['dependency'], isDirected: false, isSelected: false } })
    expect(groupTitles()).toEqual(['Dependency1'])
    expect(rowNames()).toEqual(['Import'])
  })

  it('shows both directions while a selection draws its lines, with no overlay on', () => {
    renderLegend({ lines: { overlays: [], isDirected: true, isSelected: true } })
    expect(groupTitles()).toEqual(['Dependency1'])
    expect(rowNames()).toEqual(['Depends on', 'Dependants', 'Selected'])
  })

  it('names the selection on its own while it draws no lines', () => {
    renderLegend({ lines: { overlays: [], isDirected: false, isSelected: true } })
    expect(groupTitles()).toEqual(['Selection'])
    expect(rowNames()).toEqual(['Selected'])
  })
})
