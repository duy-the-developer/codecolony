import { GitPullRequestArrowIcon, SquareTerminalIcon, XIcon } from 'lucide-react'
import type { PlacedColonist } from '../../../modules/scene/colonist-places.ts'
import { COLONIST_STATUS_TEXT } from '../../../modules/theme/colonist-glyphs.ts'
import {
  CHANGE_COLORS,
  COLONIST_CHIP,
  COLONIST_COLORS,
  CONFLICT_COLOR,
} from '../../../modules/theme/palette.ts'
import type { ChangeKind } from '../../../modules/wire/api-types.ts'
import { ColonistIcon } from '../colonist-icon/colonist-icon.tsx'
import { Button } from '../ui/button.tsx'
import { cn } from '../ui/class-names.ts'

export interface ColonistCardProps {
  placed: PlacedColonist
  // The terminal can focus the colonist's pane: Herdr is on and knows it.
  canOpenTerminal: boolean
  onClose(): void
  onOpenTerminal(paneId: string): void
  // Selects a changed file on the map.
  onPick(id: string): void
}

const LETTERS: Record<ChangeKind, string> = { modified: 'M', added: 'A', removed: 'D' }
const SESSIONS = {
  firstmate: 'firstmate worker',
  own: 'your own session',
  none: 'no live session',
} as const

// The picked colonist, in the Inspector tab: who it is, how it is going, and
// every file in its diff.
export function ColonistCard({
  placed,
  canOpenTerminal,
  onClose,
  onOpenTerminal,
  onPick,
}: ColonistCardProps) {
  const { colonist, changes } = placed
  const color = COLONIST_COLORS[colonist.status]
  const count = (kind: ChangeKind) => colonist.changes.filter((c) => c.kind === kind).length
  const fields: [string, string][] = [
    ['Task', colonist.task ?? 'not a firstmate task'],
    ['Session', SESSIONS[colonist.session] + (colonist.agent ? ` · ${colonist.agent}` : '')],
    ['Copy', colonist.copy],
    ['Branch', colonist.branch ?? `detached at ${colonist.head}`],
    ['PR', colonist.pr ?? 'none yet'],
  ]
  const { paneId } = colonist
  return (
    <div className="space-y-4 p-3 text-[13px]">
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background"
          style={{ borderColor: color }}
        >
          <ColonistIcon status={colonist.status} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[11px] text-primary uppercase tracking-wider">
            Colonist
          </p>
          <h3 className="flex items-center gap-2 font-mono font-semibold text-sm">
            <span
              title="Its pins on the map"
              className="shrink-0 rounded-full px-1.5 font-bold font-sans text-[10px] leading-4"
              style={{ background: color, color: COLONIST_CHIP }}
            >
              {placed.initials}
            </span>
            <span className="min-w-0 break-all">{colonist.label}</span>
          </h3>
          <p className="text-xs" style={{ color }}>
            ● {COLONIST_STATUS_TEXT[colonist.status]}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Close colonist"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>

      {colonist.note && (
        <p className="border-l-2 pl-2 text-muted-foreground" style={{ borderColor: color }}>
          {colonist.note}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-all font-mono text-xs leading-5">
              {label === 'PR' && colonist.pr ? (
                <a href={colonist.pr} target="_blank" rel="noreferrer" className="underline">
                  {value}
                </a>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canOpenTerminal || !paneId}
          title={paneId ? undefined : 'No terminal pane is known for this colonist'}
          onClick={() => paneId && onOpenTerminal(paneId)}
        >
          <SquareTerminalIcon />
          Open terminal
        </Button>
        {colonist.pr ? (
          <Button size="sm" asChild>
            <a href={colonist.pr} target="_blank" rel="noreferrer">
              <GitPullRequestArrowIcon />
              Show PR
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <GitPullRequestArrowIcon />
            Show PR
          </Button>
        )}
      </div>

      <section>
        <h4 className="mb-1 flex justify-between gap-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
          Files in its diff
          <span className="font-normal normal-case tracking-normal">
            {count('modified')} modified · {count('added')} added · {count('removed')} removed
          </span>
        </h4>
        <ul>
          {changes.map((change) => (
            <li key={change.path}>
              <button
                type="button"
                disabled={!change.nodeId}
                title={change.path}
                onClick={() => change.nodeId && onPick(change.nodeId)}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className="flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-dashed font-mono text-[10px]"
                  style={{
                    borderColor: CHANGE_COLORS[change.kind],
                    color: CHANGE_COLORS[change.kind],
                  }}
                >
                  {LETTERS[change.kind]}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 break-all font-mono text-xs',
                    !change.nodeId && !change.placeholder && 'text-muted-foreground',
                  )}
                >
                  {shortPath(change.path)}
                </span>
                {change.sharedWith && (
                  <span
                    className="shrink-0 text-[11px]"
                    title={`Also changed by ${change.sharedWith.length} other ${change.sharedWith.length === 1 ? 'colonist' : 'colonists'}`}
                    style={{ color: CONFLICT_COLOR }}
                  >
                    possible conflict
                  </span>
                )}
                {change.placeholder && (
                  <span className="shrink-0 text-[11px]" style={{ color: CHANGE_COLORS.added }}>
                    placeholder
                  </span>
                )}
              </button>
            </li>
          ))}
          {colonist.omitted > 0 && (
            <li className="px-1 text-muted-foreground">+ {colonist.omitted} more</li>
          )}
        </ul>
      </section>

      <p className="text-muted-foreground text-xs">
        Diff since this copy forked from {colonist.base}: committed and uncommitted changes. Each
        file carries a pin with these initials on the map. Added files show as dashed green
        placeholders in their folder until merged.
      </p>
    </div>
  )
}

// The last three parts of a long path.
function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path
}
