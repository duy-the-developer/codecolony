// What the page remembers per browser: each side panel's width, whether it is
// collapsed, and its active tab, which build queue sections are open,
// whether the map legend is open, and whether the map shows only the
// colonists at work. Storage can be missing or full (private
// windows, blocked site data), so reads fall back to defaults and writes are
// best effort.

export const LEFT_TABS = ['queue', 'files'] as const
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
  isLegendOpen: boolean
  isActiveOnly: boolean
}

// A panel can be dragged as wide as the map and the other panel allow: the map
// keeps at least this share of the window, the other panel its minimum.
export const MIN_PANEL_PX = 220
export const MIN_MAP_PERCENT = 25

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  left: { widthPx: 280, isCollapsed: false, tab: 'queue' },
  right: { widthPx: 420, isCollapsed: false, tab: 'terminal' },
  openQueueSections: { active: true, queued: true, done: false },
  isLegendOpen: false,
  isActiveOnly: false,
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
    isLegendOpen:
      typeof record.isLegendOpen === 'boolean'
        ? record.isLegendOpen
        : DEFAULT_SHELL_PREFERENCES.isLegendOpen,
    isActiveOnly:
      typeof record.isActiveOnly === 'boolean'
        ? record.isActiveOnly
        : DEFAULT_SHELL_PREFERENCES.isActiveOnly,
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
        ? Math.max(Math.round(widthPx), MIN_PANEL_PX)
        : fallback.widthPx,
    isCollapsed: typeof isCollapsed === 'boolean' ? isCollapsed : fallback.isCollapsed,
    tab: tabs.find((known) => known === tab) ?? fallback.tab,
  }
}

// The widest a panel can be dragged in a group this wide. Without it, dragging
// past the map's minimum would push the other panel shut.
export function maxPanelWidthPx(groupPx: number, isOtherOpen: boolean): number {
  const roomPx = (groupPx * (100 - MIN_MAP_PERCENT)) / 100
  return Math.max(roomPx - (isOtherOpen ? MIN_PANEL_PX : 0), MIN_PANEL_PX)
}

// Shrinks remembered widths that no longer fit beside the map, as when the
// window is smaller than when they were saved. Each open panel gives up room in
// proportion to how far it is above its minimum. A collapsed panel is 0.
export function fitPanelWidths(
  widthsPx: Record<'left' | 'right', number>,
  groupPx: number,
): Record<'left' | 'right', number> {
  const roomPx = (groupPx * (100 - MIN_MAP_PERCENT)) / 100
  const excessPx = widthsPx.left + widthsPx.right - roomPx
  const slackPx = (widthPx: number) => (widthPx > 0 ? Math.max(widthPx - MIN_PANEL_PX, 0) : 0)
  const totalSlackPx = slackPx(widthsPx.left) + slackPx(widthsPx.right)
  if (excessPx <= 0 || totalSlackPx <= 0) return widthsPx
  const shrink = (widthPx: number) =>
    widthPx - (slackPx(widthPx) * Math.min(excessPx, totalSlackPx)) / totalSlackPx
  return { left: shrink(widthsPx.left), right: shrink(widthsPx.right) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
