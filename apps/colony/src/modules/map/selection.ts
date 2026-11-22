// What a click on the map does to the selection. A plain click replaces it;
// with the toggle key held (Cmd on a Mac, Ctrl elsewhere) it adds the node or
// takes it out. A click on empty map clears it, and a toggle click there
// leaves it alone. Selected ids are kept in the order they were added, so the
// last one is the node the panels follow.

export type SelectMode = 'replace' | 'toggle'

export function buildSelection(
  current: readonly string[],
  id: string | undefined,
  mode: SelectMode,
): readonly string[] {
  if (mode === 'replace') return id === undefined ? [] : [id]
  if (id === undefined) return current
  return current.includes(id) ? current.filter((held) => held !== id) : [...current, id]
}

export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

// The nodes whose connections stand out: the selection, else the hovered
// node. Hovering never changes them while anything is selected, so the map can
// be panned to follow the selection's connections.
export function listFocusIds(
  selected: readonly string[],
  hovered: string | undefined,
): readonly string[] {
  if (selected.length > 0) return selected
  return hovered === undefined ? [] : [hovered]
}

interface ModifierKeys {
  metaKey: boolean
  ctrlKey: boolean
}

export function isToggleClick(event: ModifierKeys, isMac: boolean): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
}

// How the panels name the toggle key.
export function toggleKeyLabel(isMac: boolean): string {
  return isMac ? '⌘' : 'Ctrl'
}
