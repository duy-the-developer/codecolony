import { describe, expect, it } from 'vitest'
import { buildSelection, isToggleClick, listFocusIds, sameSelection } from './selection.ts'

describe('buildSelection', () => {
  it('replaces the selection on a plain click', () => {
    expect(buildSelection(['a', 'b'], 'c', 'replace')).toEqual(['c'])
  })

  it('clears the selection on a plain click on empty map', () => {
    expect(buildSelection(['a', 'b'], undefined, 'replace')).toEqual([])
  })

  it('adds a node on a toggle click, keeping the order of adding', () => {
    expect(buildSelection(['a'], 'b', 'toggle')).toEqual(['a', 'b'])
    expect(buildSelection([], 'a', 'toggle')).toEqual(['a'])
  })

  it('takes a selected node out on a toggle click', () => {
    expect(buildSelection(['a', 'b', 'c'], 'b', 'toggle')).toEqual(['a', 'c'])
    expect(buildSelection(['a'], 'a', 'toggle')).toEqual([])
  })

  it('keeps the selection on a toggle click on empty map', () => {
    const current = ['a', 'b']
    expect(buildSelection(current, undefined, 'toggle')).toBe(current)
  })
})

describe('sameSelection', () => {
  it('compares ids and their order', () => {
    expect(sameSelection(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameSelection(['a'], ['a', 'b'])).toBe(false)
    expect(sameSelection([], [])).toBe(true)
  })
})

describe('listFocusIds', () => {
  it('follows the hovered node while nothing is selected', () => {
    expect(listFocusIds([], 'h')).toEqual(['h'])
    expect(listFocusIds([], undefined)).toEqual([])
  })

  it('ignores the hovered node while anything is selected', () => {
    expect(listFocusIds(['a'], 'h')).toEqual(['a'])
    expect(listFocusIds(['a', 'b'], 'h')).toEqual(['a', 'b'])
  })
})

describe('isToggleClick', () => {
  it('uses Cmd on a Mac and Ctrl elsewhere', () => {
    expect(isToggleClick({ metaKey: true, ctrlKey: false }, true)).toBe(true)
    expect(isToggleClick({ metaKey: false, ctrlKey: true }, true)).toBe(false)
    expect(isToggleClick({ metaKey: false, ctrlKey: true }, false)).toBe(true)
    expect(isToggleClick({ metaKey: true, ctrlKey: false }, false)).toBe(false)
  })
})
