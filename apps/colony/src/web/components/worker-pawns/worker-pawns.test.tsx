// @vitest-environment jsdom
import type { DockWorker } from '@codecolony/dock/web'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerPawns } from './worker-pawns.tsx'

const WORKER: DockWorker = {
  paneId: 'w4:p1',
  workspaceId: 'w4',
  agent: 'claude',
  name: null,
  label: 'alphagal-mockup',
  status: 'working',
  focused: false,
}

describe('WorkerPawns', () => {
  afterEach(cleanup)

  it('labels each pawn by workspace and keeps agent, pane and status on hover', () => {
    render(<WorkerPawns workers={[WORKER]} onFocus={() => {}} />)
    const pawn = screen.getByRole('button', { name: 'alphagal-mockup' })
    expect(pawn.title).toBe('claude · pane w4:p1 · working')
  })

  it('focuses the worker when clicked', () => {
    const onFocus = vi.fn()
    render(<WorkerPawns workers={[WORKER]} onFocus={onFocus} />)
    fireEvent.click(screen.getByRole('button', { name: 'alphagal-mockup' }))
    expect(onFocus).toHaveBeenCalledWith(WORKER)
  })

  it('renders nothing without workers', () => {
    const { container } = render(<WorkerPawns workers={[]} onFocus={() => {}} />)
    expect(container.childElementCount).toBe(0)
  })
})
