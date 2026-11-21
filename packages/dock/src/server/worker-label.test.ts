import { describe, expect, it } from 'vitest'
import { resolveWorkerLabel, type WorkerLabelSource } from './worker-label.ts'

const BASE: WorkerLabelSource = {
  paneId: 'w4:p1',
  agent: 'claude',
  name: null,
  workspaceLabel: null,
  tabLabel: null,
}

describe('resolveWorkerLabel', () => {
  it('uses the workspace label', () => {
    expect(resolveWorkerLabel({ ...BASE, workspaceLabel: 'firstmate' })).toBe('firstmate')
  })

  it('strips the tree marker and parent tag of a launched worker', () => {
    expect(
      resolveWorkerLabel({ ...BASE, workspaceLabel: '└ alphagal-mockup · p:w2', tabLabel: '1' }),
    ).toBe('alphagal-mockup')
  })

  it('falls back to the tab label without its launcher prefix', () => {
    expect(resolveWorkerLabel({ ...BASE, tabLabel: 'fm-codecolony-tech' })).toBe('codecolony-tech')
  })

  it('skips numbered default tabs', () => {
    expect(resolveWorkerLabel({ ...BASE, tabLabel: '2', name: 'dock' })).toBe('dock')
  })

  it('falls back to the agent name, then its kind, then the pane', () => {
    expect(resolveWorkerLabel({ ...BASE, name: 'dock' })).toBe('dock')
    expect(resolveWorkerLabel(BASE)).toBe('claude')
    expect(resolveWorkerLabel({ ...BASE, agent: null })).toBe('w4:p1')
  })
})
