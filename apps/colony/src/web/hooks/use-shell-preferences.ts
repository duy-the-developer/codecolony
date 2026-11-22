import { useCallback, useState } from 'react'
import {
  findBrowserStorage,
  readShellPreferences,
  type ShellPreferences,
  saveShellPreferences,
} from '../../modules/preferences/shell-preferences.ts'

export type UpdateShellPreferences = (
  update: (current: ShellPreferences) => ShellPreferences,
) => void

// Panel widths, collapsed state and tabs, remembered in this browser.
export function useShellPreferences(): [ShellPreferences, UpdateShellPreferences] {
  const [preferences, setPreferences] = useState(() => readShellPreferences(findBrowserStorage()))
  const update = useCallback<UpdateShellPreferences>((change) => {
    setPreferences((current) => {
      const next = change(current)
      if (next !== current) saveShellPreferences(findBrowserStorage(), next)
      return next
    })
  }, [])
  return [preferences, update]
}
