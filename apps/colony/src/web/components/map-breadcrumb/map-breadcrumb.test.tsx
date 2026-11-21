// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { World, WorldNode } from '../../../shared/world-types.ts'
import { Scene } from '../../scene.ts'
import { MapBreadcrumb } from './map-breadcrumb.tsx'

const RECT = { x: 0, y: 0, w: 1, h: 1 }

function node(id: string, parent: string, kind: WorldNode['kind']): WorldNode {
  return { id, parent, kind, name: id, lines: 1, complexity: 1, rect: RECT }
}

const SCENE = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    { id: 'world', kind: 'world', name: 'world', lines: 1, complexity: 1, rect: RECT },
    node('codecolony', 'world', 'project'),
    node('packages', 'codecolony', 'module'),
    node('dock', 'packages', 'module'),
    node('src', 'dock', 'module'),
    node('herdr.ts', 'src', 'file'),
    node('workspaceName', 'herdr.ts', 'symbol'),
  ],
  edges: [],
} satisfies World)

function names(): string[] {
  return screen.getAllByRole('button').map((b) => b.textContent ?? '')
}

describe('MapBreadcrumb', () => {
  afterEach(cleanup)

  it('folds the middle ancestors of a deep selection into one item', () => {
    render(
      <MapBreadcrumb scene={SCENE} selected={SCENE.byId.get('workspaceName')} onPick={() => {}} />,
    )
    expect(names()).toEqual(['codecolony', 'herdr.ts', 'workspaceName'])
    expect(screen.getByTitle('packages › dock › src').textContent).toBe('…')
  })

  it('shows a short path in full', () => {
    render(<MapBreadcrumb scene={SCENE} selected={SCENE.byId.get('src')} onPick={() => {}} />)
    expect(names()).toEqual(['codecolony', 'packages', 'dock', 'src'])
    expect(screen.queryByText('…')).toBeNull()
  })

  it('keeps the selected name out of the shrinking ancestor group', () => {
    render(
      <MapBreadcrumb scene={SCENE} selected={SCENE.byId.get('workspaceName')} onPick={() => {}} />,
    )
    const selected = screen.getByRole('button', { name: 'workspaceName' })
    const ancestors = screen.getByRole('button', { name: 'herdr.ts' }).parentElement
    expect(ancestors?.contains(selected)).toBe(false)
    expect(ancestors?.contains(screen.getByTitle('packages › dock › src'))).toBe(true)
    expect(selected.parentElement).toBe(screen.getByRole('navigation', { name: 'Selection path' }))
  })

  it('picks an ancestor when clicked', () => {
    const onPick = vi.fn()
    render(
      <MapBreadcrumb scene={SCENE} selected={SCENE.byId.get('workspaceName')} onPick={onPick} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'herdr.ts' }))
    expect(onPick).toHaveBeenCalledWith('herdr.ts')
  })
})
