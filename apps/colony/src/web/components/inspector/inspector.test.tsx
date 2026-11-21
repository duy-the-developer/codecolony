// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Edge, World, WorldNode } from '../../../shared/world-types.ts'
import { Scene } from '../../scene.ts'
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

describe('Inspector', () => {
  afterEach(cleanup)

  it('lists dependencies under engineering names', () => {
    render(
      <Inspector
        scene={SCENE}
        selected={SCENE.byId.get('api.ts')}
        onPick={() => {}}
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
        selected={SCENE.byId.get('api.ts')}
        onPick={onPick}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /model\.ts/ }))
    expect(onPick).toHaveBeenCalledWith('model.ts')
  })

  it('asks for a selection when there is none', () => {
    render(
      <Inspector
        scene={SCENE}
        selected={undefined}
        onPick={() => {}}
        onTraceCalls={() => Promise.resolve()}
      />,
    )
    expect(screen.getByText('Click anything on the map to inspect it.')).toBeTruthy()
  })
})
