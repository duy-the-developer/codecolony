// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SearchEntry, SearchMatches } from '../../../shared/api-types.ts'
import { SearchPalette } from './search-palette.tsx'

function file(id: string): SearchEntry {
  return { id, kind: 'file', name: id, path: id, lines: 3 }
}

const FILES = [file('pack.ts'), file('pack-rows.ts')]

function fetchMatches(query: string): Promise<SearchMatches> {
  return Promise.resolve({ symbols: [], files: FILES.filter((f) => f.name.includes(query)) })
}

async function renderPalette() {
  const onPick = vi.fn()
  const onOpen = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SearchPalette
      isOpen
      fetchMatches={fetchMatches}
      onOpenChange={onOpenChange}
      onPick={onPick}
      onOpen={onOpen}
    />,
  )
  const input = screen.getByPlaceholderText('Search files and symbols')
  fireEvent.change(input, { target: { value: 'pack' } })
  await screen.findByText('pack-rows.ts')
  return { input, onPick, onOpen, onOpenChange }
}

describe('SearchPalette', () => {
  beforeAll(() => {
    // cmdk measures and scrolls its list; jsdom has no layout.
    Element.prototype.scrollIntoView = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })
  afterEach(cleanup)

  it('flies to the highlighted result on Enter', async () => {
    const { input, onPick, onOpen } = await renderPalette()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('pack.ts')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens the highlighted result in the File tab on Shift+Enter', async () => {
    const { input, onPick, onOpen, onOpenChange } = await renderPalette()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onOpen).toHaveBeenCalledWith('pack-rows.ts')
    expect(onPick).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
