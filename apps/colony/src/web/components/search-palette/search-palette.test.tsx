// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { World, WorldNode } from '../../../shared/world-types.ts'
import { buildSearchIndex } from '../../search-index.ts'
import { SearchPalette } from './search-palette.tsx'

const RECT = { x: 0, y: 0, w: 1, h: 1 }

function file(id: string): WorldNode {
  return {
    id,
    parent: 'world',
    kind: 'file',
    name: id,
    path: id,
    lines: 3,
    complexity: 1,
    rect: RECT,
  }
}

const INDEX = buildSearchIndex({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [file('pack.ts'), file('pack-rows.ts')],
  edges: [],
} satisfies World)

function renderPalette() {
  const onPick = vi.fn()
  const onOpen = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SearchPalette
      isOpen
      index={INDEX}
      onOpenChange={onOpenChange}
      onPick={onPick}
      onOpen={onOpen}
    />,
  )
  const input = screen.getByPlaceholderText('Search files and symbols')
  fireEvent.change(input, { target: { value: 'pack' } })
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

  it('flies to the highlighted result on Enter', () => {
    const { input, onPick, onOpen } = renderPalette()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('pack.ts')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens the highlighted result in the File tab on Shift+Enter', () => {
    const { input, onPick, onOpen, onOpenChange } = renderPalette()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onOpen).toHaveBeenCalledWith('pack-rows.ts')
    expect(onPick).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
