// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { World, WorldNode } from '../../../shared/world-types.ts'
import { Scene } from '../../scene.ts'
import { Legend } from './legend.tsx'

const RECT = { x: 0, y: 0, w: 1, h: 1 }

function node(id: string, parent: string, kind: WorldNode['kind']): WorldNode {
  return {
    id,
    parent,
    kind,
    name: id.split('/').at(-1) ?? id,
    path: id,
    lines: 1,
    complexity: 1,
    rect: RECT,
  }
}

function scene(nodes: WorldNode[]): Scene {
  return new Scene({
    version: 1,
    indexedAt: '',
    languages: {},
    nodes: [
      { id: 'world', kind: 'world', name: 'world', lines: 1, complexity: 1, rect: RECT },
      node('codecolony', 'world', 'project'),
      ...nodes,
    ],
    edges: [],
  } satisfies World)
}

function moduleLabels(): string[] {
  const section = screen.getByRole('heading', { name: /^Modules/ }).parentElement
  return [...(section?.querySelectorAll('li') ?? [])].map((li) => li.textContent ?? '')
}

describe('Legend', () => {
  afterEach(cleanup)

  it('keys colours by the modules that hold files, descending into packages', () => {
    render(
      <Legend
        scene={scene([
          node('packages/dock', 'codecolony', 'package'),
          node('packages/dock/src', 'packages/dock', 'module'),
          node('packages/dock/src/web', 'packages/dock/src', 'module'),
          node('packages/dock/src/web/dock.ts', 'packages/dock/src/web', 'file'),
          node('packages/dock/src/index.ts', 'packages/dock/src', 'file'),
          node('apps/colony', 'codecolony', 'package'),
          node('apps/colony/main.ts', 'apps/colony', 'file'),
        ])}
      />,
    )
    expect(moduleLabels()).toEqual([
      'apps/colony',
      'packages/dock/src',
      'packages/dock/src/web',
      'Tests (greyed out)',
    ])
  })

  it('caps the list at ten modules', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => [
      node(`m${String(i).padStart(2, '0')}`, 'codecolony', 'module'),
      node(`m${String(i).padStart(2, '0')}/a.ts`, `m${String(i).padStart(2, '0')}`, 'file'),
    ]).flat()
    render(<Legend scene={scene(nodes)} />)
    expect(moduleLabels()).toHaveLength(11)
  })
})
