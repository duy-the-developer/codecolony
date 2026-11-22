import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHELL_PREFERENCES,
  fitPanelWidths,
  MIN_PANEL_PX,
  maxPanelWidthPx,
  readShellPreferences,
  saveShellPreferences,
  shellPreferencesFrom,
} from './shell-preferences.ts'

describe('shellPreferencesFrom', () => {
  it('falls back to the defaults for missing or broken data', () => {
    expect(shellPreferencesFrom(null)).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(shellPreferencesFrom('{nope')).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(shellPreferencesFrom('[]')).toEqual(DEFAULT_SHELL_PREFERENCES)
  })

  it('keeps valid fields, clamps widths and drops unknown tabs and section states', () => {
    const raw = JSON.stringify({
      left: { widthPx: 9999.4, isCollapsed: true, tab: 'files' },
      right: { widthPx: 'wide', isCollapsed: 'no', tab: 'map' },
      openQueueSections: { active: false, queued: 'yes', done: true },
    })
    expect(shellPreferencesFrom(raw)).toEqual({
      left: { widthPx: 9999, isCollapsed: true, tab: 'files' },
      right: DEFAULT_SHELL_PREFERENCES.right,
      openQueueSections: { active: false, queued: true, done: true },
    })
  })

  it('raises widths below the minimum', () => {
    const raw = JSON.stringify({ left: { widthPx: 40, isCollapsed: false, tab: 'queue' } })
    expect(shellPreferencesFrom(raw).left.widthPx).toBe(MIN_PANEL_PX)
  })
})

describe('maxPanelWidthPx', () => {
  it('leaves the map its share and the other open panel its minimum', () => {
    expect(maxPanelWidthPx(1800, true)).toBe(1350 - MIN_PANEL_PX)
    expect(maxPanelWidthPx(1800, false)).toBe(1350)
  })

  it('never drops below the minimum in a narrow window', () => {
    expect(maxPanelWidthPx(400, true)).toBe(MIN_PANEL_PX)
  })
})

describe('fitPanelWidths', () => {
  it('keeps widths that leave the map its share', () => {
    expect(fitPanelWidths({ left: 1000, right: 350 }, 1800)).toEqual({ left: 1000, right: 350 })
  })

  it('shrinks each open panel by its share of the room above its minimum', () => {
    // 1120 wide leaves 840 beside the map; 400 too much, taken 3:1.
    expect(fitPanelWidths({ left: 820, right: 420 }, 1120)).toEqual({ left: 520, right: 320 })
  })

  it('takes everything from the one open panel when the other is collapsed', () => {
    expect(fitPanelWidths({ left: 0, right: 1500 }, 1000)).toEqual({ left: 0, right: 750 })
  })

  it('stops at the minimums when even they do not fit', () => {
    expect(fitPanelWidths({ left: 900, right: 900 }, 500)).toEqual({
      left: MIN_PANEL_PX,
      right: MIN_PANEL_PX,
    })
  })
})

describe('readShellPreferences', () => {
  it('round-trips through storage', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    }
    const preferences = {
      ...DEFAULT_SHELL_PREFERENCES,
      right: { widthPx: 500, isCollapsed: false, tab: 'inspector' as const },
    }
    saveShellPreferences(storage, preferences)
    expect(readShellPreferences(storage)).toEqual(preferences)
  })

  it('falls back to the defaults without storage', () => {
    expect(readShellPreferences(undefined)).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(() => saveShellPreferences(undefined, DEFAULT_SHELL_PREFERENCES)).not.toThrow()
  })

  it('survives storage that throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readShellPreferences(blocked)).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(() => saveShellPreferences(blocked, DEFAULT_SHELL_PREFERENCES)).not.toThrow()
  })
})
