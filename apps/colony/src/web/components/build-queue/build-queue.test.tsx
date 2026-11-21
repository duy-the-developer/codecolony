// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BuildQueue } from './build-queue.tsx'

describe('BuildQueue', () => {
  afterEach(cleanup)

  it('has the single place-an-order button, not yet enabled', () => {
    render(<BuildQueue />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Order'])
    expect(buttons[0]).toHaveProperty('disabled', true)
  })
})
