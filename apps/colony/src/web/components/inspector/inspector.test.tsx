// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlacedColonist } from '../../../modules/scene/colonist-places.ts'
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
        colonists={[]}
        onPick={() => {}}
        onPickColonist={() => {}}
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
        colonists={[]}
        onPick={onPick}
        onPickColonist={() => {}}
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
        colonists={[]}
        onPick={() => {}}
        onPickColonist={() => {}}
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
        colonists={[]}
        onPick={() => {}}
        onPickColonist={() => {}}
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
        colonists={[]}
        onPick={onPick}
        onPickColonist={() => {}}
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

  it('lists the colonists changing a file and flags a possible conflict', () => {
    const colonist = (id: string, label: string, initials: string, other: string) => ({
      colonist: {
        id,
        repoId: 'world',
        label,
        status: 'working' as const,
        session: 'firstmate' as const,
        copy: id,
        head: 'abc1234',
        base: 'main',
        changes: [{ path: 'api.ts', kind: 'modified' as const, units: 1 }],
        omitted: 0,
      },
      initials,
      changes: [
        { path: 'api.ts', kind: 'modified' as const, nodeId: 'api.ts', sharedWith: [other] },
      ],
      folders: [],
    })
    const colonists: PlacedColonist[] = [
      colonist('/one', 'colonist-pins', 'CP', '/two'),
      colonist('/two', 'build-queue', 'BQ', '/one'),
    ]
    const onPickColonist = vi.fn()
    render(
      <Inspector
        scene={SCENE}
        selection={[node('api.ts')]}
        colonists={colonists}
        onPick={() => {}}
        onPickColonist={onPickColonist}
        onOpen={() => {}}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    expect(screen.getByText(/Possible conflict/)).toBeTruthy()
    const rows = within(screen.getByRole('list', { name: 'Colonists changing it' })).getAllByRole(
      'button',
    )
    expect(rows.map((row) => row.textContent)).toEqual([
      'CPcolonist-pinsworking',
      'BQbuild-queueworking',
    ])
    fireEvent.click(rows[1] as HTMLElement)
    expect(onPickColonist).toHaveBeenCalledWith('/two')
  })
})
