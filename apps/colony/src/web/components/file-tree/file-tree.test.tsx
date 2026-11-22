// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Scene } from '../../../modules/scene/scene.ts'
import type { World, WorldNode } from '../../../modules/world/world-types.ts'
import { FileTree } from './file-tree.tsx'

const RECT = { x: 0, y: 0, w: 1, h: 1 }

function node(id: string, parent: string, kind: WorldNode['kind']): WorldNode {
  const name = id.split('/').at(-1) ?? id
  return { id, parent, kind, name, path: id, lines: 1, complexity: 1, rect: RECT }
}

const SCENE = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    { id: 'world', kind: 'world', name: 'world', lines: 1, complexity: 1, rect: RECT },
    node('src', 'world', 'module'),
    node('src/pack.ts', 'src', 'file'),
  ],
  edges: [],
} satisfies World)

describe('FileTree', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {}
  })
  afterEach(cleanup)

  it('flies to a file on click and opens it on double-click', () => {
    const onPick = vi.fn()
    const onOpen = vi.fn()
    render(<FileTree scene={SCENE} selected={undefined} onPick={onPick} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    const file = screen.getByRole('button', { name: /pack\.ts/ })
    fireEvent.click(file)
    expect(onPick).toHaveBeenCalledWith('src/pack.ts')
    fireEvent.doubleClick(file)
    expect(onOpen).toHaveBeenCalledWith('src/pack.ts')
  })
})
