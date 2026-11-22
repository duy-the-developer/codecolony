// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scene } from '../../../modules/scene/scene.ts'
import type { Edge, World, WorldNode } from '../../../modules/world/world-types.ts'
import { Inspector } from './inspector.tsx'

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

function edge(kind: Edge['kind'], from: string, to: string): Edge {
  return { kind, from, to, provenance: 'lsp', at: { file: from, line: 4 } }
}

const SCENE = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    { id: 'world', kind: 'world', name: 'world', lines: 9, complexity: 3, rect: RECT },
    file('api.ts'),
    file('model.ts'),
    file('main.ts'),
  ],
  edges: [
    edge('import', 'api.ts', 'model.ts'),
    edge('import', 'main.ts', 'api.ts'),
    edge('call', 'main.ts', 'api.ts'),
  ],
} satisfies World)

function node(id: string): WorldNode {
  const found = SCENE.byId.get(id)
  if (!found) throw new Error(id)
  return found
}

describe('Inspector', () => {
  afterEach(cleanup)

  it('lists dependencies under engineering names', () => {
    render(
      <Inspector
        scene={SCENE}
        selection={[node('api.ts')]}
        onPick={() => {}}
        onOpen={() => {}}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(['Imports1', 'Imported by1', 'Called by1'])
    expect(document.body.textContent).not.toMatch(/road/i)
  })

  it('picks the node at the other end of a row', () => {
    const onPick = vi.fn()
    render(
      <Inspector
        scene={SCENE}
        selection={[node('api.ts')]}
        onPick={onPick}
        onOpen={() => {}}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /model\.ts/ }))
    expect(onPick).toHaveBeenCalledWith('model.ts')
  })

  it('opens a file in the File tab', () => {
    const onOpen = vi.fn()
    render(
      <Inspector
        scene={SCENE}
        selection={[node('api.ts')]}
        onPick={() => {}}
        onOpen={onOpen}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
    expect(onOpen).toHaveBeenCalledWith('api.ts')
  })

  it('asks for a selection when there is none', () => {
    render(
      <Inspector
        scene={SCENE}
        selection={[]}
        onPick={() => {}}
        onOpen={() => {}}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    expect(screen.getByText('Click anything on the map to inspect it.')).toBeTruthy()
  })

  it('shows several selected nodes combined', () => {
    const onPick = vi.fn()
    render(
      <Inspector
        scene={SCENE}
        selection={[node('api.ts'), node('model.ts')]}
        onPick={onPick}
        onOpen={() => {}}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    expect(screen.getByText('2 selected')).toBeTruthy()
    const items = within(screen.getByRole('list', { name: 'Selected' })).getAllByRole('button')
    expect(items.map((item) => item.textContent)).toEqual(['fileapi.ts', 'filemodel.ts'])
    const facts = [...document.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextSibling?.textContent,
    ])
    expect(facts).toEqual([
      ['Files', '2'],
      ['Imports between them', '1'],
      ['Imports out', '0'],
      ['Imported by others', '1'],
    ])
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(['Imported by1', 'Called by1'])
    fireEvent.click(items[1] as HTMLElement)
    expect(onPick).toHaveBeenCalledWith('model.ts')
  })
})
