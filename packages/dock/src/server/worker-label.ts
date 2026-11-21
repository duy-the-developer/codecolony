// Works out the human label for a worker from what Herdr reports, so a worker
// reads `firstmate` or `alphagal-mockup` instead of `claude` for every pane.
//
// - Workspace label: `firstmate`, or `└ alphagal-mockup · p:<parent id>` for a
//   worker a supervisor launched. The tree marker and the parent tag go.
// - Tab label: `fm-alphagal-mockup`. A known launcher prefix goes. Herdr's
//   default numbered tabs (`1`, `2`) name nothing.
// - Otherwise the agent's name, its kind, then the pane id.

export interface WorkerLabelSource {
  paneId: string
  agent: string | null
  name: string | null
  workspaceLabel: string | null
  tabLabel: string | null
}

const TREE_MARKER = /^[\s└├│─]+/u
const PARENT_TAG = /\s+·\s+p:\S*$/u
const LAUNCHER_PREFIXES = ['fm-'] as const
const NUMBERED_TAB = /^\d+$/

export function resolveWorkerLabel(source: WorkerLabelSource): string {
  const workspace = workspaceName(source.workspaceLabel)
  if (workspace) return workspace
  const tab = tabName(source.tabLabel)
  if (tab) return tab
  return source.name || source.agent || source.paneId
}

function workspaceName(label: string | null): string {
  return (label ?? '').replace(TREE_MARKER, '').replace(PARENT_TAG, '').trim()
}

function tabName(label: string | null): string {
  const trimmed = (label ?? '').trim()
  if (NUMBERED_TAB.test(trimmed)) return ''
  const prefix = LAUNCHER_PREFIXES.find((p) => trimmed.startsWith(p) && trimmed.length > p.length)
  return prefix ? trimmed.slice(prefix.length) : trimmed
}
