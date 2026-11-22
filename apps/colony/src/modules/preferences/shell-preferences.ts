// What the page remembers per browser: each side panel's width, whether it is
// collapsed, and its active tab, and which build queue sections are open. Storage can be missing or full (private
// windows, blocked site data), so reads fall back to defaults and writes are
// best effort.

export const LEFT_TABS = ['queue', 'legend', 'files'] as const
export type LeftTab = (typeof LEFT_TABS)[number]
export const RIGHT_TABS = ['terminal', 'file', 'inspector'] as const
export type RightTab = (typeof RIGHT_TABS)[number]

export interface PanelPreferences<Tab extends string> {
  widthPx: number
  isCollapsed: boolean
  tab: Tab
}

// The build queue's sections, as in VS Code's Source Control view.
export const QUEUE_SECTIONS = ['active', 'queued', 'done'] as const
export type QueueSection = (typeof QUEUE_SECTIONS)[number]

export interface ShellPreferences {
  left: PanelPreferences<LeftTab>
  right: PanelPreferences<RightTab>
  openQueueSections: Record<QueueSection, boolean>
}

export const MIN_PANEL_PX = 220
export const MAX_PANEL_PX = 720

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  left: { widthPx: 280, isCollapsed: false, tab: 'queue' },
  right: { widthPx: 420, isCollapsed: false, tab: 'terminal' },
  openQueueSections: { active: true, queued: true, done: false },
}

const STORAGE_KEY = 'codecolony.shell.v1'

// The page's localStorage; even reading the property throws when site data
// is blocked.
export function findBrowserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readShellPreferences(
  storage: Pick<Storage, 'getItem'> | undefined,
): ShellPreferences {
  try {
    return shellPreferencesFrom(storage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    return DEFAULT_SHELL_PREFERENCES
  }
}

export function saveShellPreferences(
  storage: Pick<Storage, 'setItem'> | undefined,
  preferences: ShellPreferences,
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Not remembered this time; the page keeps working.
  }
}

// Keeps each valid saved field and fills the rest from the defaults.
export function shellPreferencesFrom(raw: string | null): ShellPreferences {
  let saved: unknown
  try {
    saved = raw === null ? null : JSON.parse(raw)
  } catch {
    saved = null
  }
  const record = isRecord(saved) ? saved : {}
  return {
    left: panelFrom(record.left, DEFAULT_SHELL_PREFERENCES.left, LEFT_TABS),
    right: panelFrom(record.right, DEFAULT_SHELL_PREFERENCES.right, RIGHT_TABS),
    openQueueSections: queueSectionsFrom(record.openQueueSections),
  }
}

function queueSectionsFrom(value: unknown): Record<QueueSection, boolean> {
  const fallback = DEFAULT_SHELL_PREFERENCES.openQueueSections
  if (!isRecord(value)) return fallback
  const pick = (section: QueueSection) => {
    const isOpen = value[section]
    return typeof isOpen === 'boolean' ? isOpen : fallback[section]
  }
  return { active: pick('active'), queued: pick('queued'), done: pick('done') }
}

function panelFrom<Tab extends string>(
  value: unknown,
  fallback: PanelPreferences<Tab>,
  tabs: readonly Tab[],
): PanelPreferences<Tab> {
  if (!isRecord(value)) return fallback
  const { widthPx, isCollapsed, tab } = value
  return {
    widthPx:
      typeof widthPx === 'number' && Number.isFinite(widthPx)
        ? Math.min(Math.max(Math.round(widthPx), MIN_PANEL_PX), MAX_PANEL_PX)
        : fallback.widthPx,
    isCollapsed: typeof isCollapsed === 'boolean' ? isCollapsed : fallback.isCollapsed,
    tab: tabs.find((known) => known === tab) ?? fallback.tab,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
