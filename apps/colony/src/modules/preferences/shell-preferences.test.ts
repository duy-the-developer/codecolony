import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHELL_PREFERENCES,
  MAX_PANEL_PX,
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

  it('keeps valid fields, clamps widths and drops unknown tabs', () => {
    const raw = JSON.stringify({
      left: { widthPx: 9999, isCollapsed: true, tab: 'files' },
      right: { widthPx: 'wide', isCollapsed: 'no', tab: 'map' },
    })
    expect(shellPreferencesFrom(raw)).toEqual({
      left: { widthPx: MAX_PANEL_PX, isCollapsed: true, tab: 'files' },
      right: DEFAULT_SHELL_PREFERENCES.right,
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
