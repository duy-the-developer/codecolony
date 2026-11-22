import { describe, expect, it } from 'vitest'
import { OVERLAYS, type OverlayId, resolveOverlayKey } from './overlays.ts'

describe('resolveOverlayKey', () => {
  it('toggles Dependency, Git and Owners with 1, 2 and 3', () => {
    expect(OVERLAYS.map((overlay) => [overlay.key, overlay.id])).toEqual([
      ['1', 'dependency'],
      ['2', 'git'],
      ['3', 'owners'],
    ])
    const git = resolveOverlayKey(new Set(), '2')
    expect([...(git ?? [])]).toEqual(['git'])
    const both = resolveOverlayKey(git ?? new Set(), '3')
    expect([...(both ?? [])]).toEqual(['git', 'owners'])
    expect([...(resolveOverlayKey(both ?? new Set(), '2') ?? [])]).toEqual(['owners'])
  })

  it('switches every overlay off with 0', () => {
    const all = new Set<OverlayId>(['dependency', 'git', 'owners'])
    expect(resolveOverlayKey(all, '0')?.size).toBe(0)
  })

  it('leaves other keys alone', () => {
    expect(resolveOverlayKey(new Set(), '4')).toBeUndefined()
    expect(resolveOverlayKey(new Set(), 'Escape')).toBeUndefined()
    expect(resolveOverlayKey(new Set(), 'F1')).toBeUndefined()
  })
})
