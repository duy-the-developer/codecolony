import { COLONIST_STATUS_TEXT } from '../../../modules/theme/colonist-glyphs.ts'
import type { Colonist } from '../../../modules/wire/api-types.ts'
import { ColonistIcon } from '../colonist-icon/colonist-icon.tsx'
import { cn } from '../ui/class-names.ts'

export interface ColonistRosterProps {
  colonists: readonly Colonist[]
  // Why the colonists cannot be shown, in place of the robots.
  notice?: string | undefined
  selectedId: string | undefined
  onPick(id: string): void
}

// The colonists at a glance, over the map's top right corner: one robot per
// colonist; the picked one shows its name and how many files it changes.
// Absent with no colonists, unless there is a notice to show instead.
export function ColonistRoster({ colonists, notice, selectedId, onPick }: ColonistRosterProps) {
  if (notice) {
    return (
      <p
        role="status"
        className="pointer-events-auto w-64 max-w-full rounded-md border border-destructive/50 bg-card/90 px-3 py-1.5 text-muted-foreground text-xs shadow-sm"
      >
        <span className="text-destructive">Colonists hidden</span> · {notice}
      </p>
    )
  }
  if (colonists.length === 0) return null
  return (
    <nav
      aria-label="Colonists"
      className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full border bg-card/90 py-1 pr-1.5 pl-3 shadow-sm"
    >
      <span className="mr-1 shrink-0 text-muted-foreground text-xs">
        Colonists <span className="text-foreground">{colonists.length}</span>
      </span>
      {colonists.map((colonist) => {
        const isSelected = colonist.id === selectedId
        const files = colonist.changes.length + colonist.omitted
        return (
          <button
            key={colonist.id}
            type="button"
            aria-pressed={isSelected}
            title={`${colonist.label} · ${COLONIST_STATUS_TEXT[colonist.status]} · ${files} ${files === 1 ? 'file' : 'files'}`}
            onClick={() => onPick(colonist.id)}
            className={cn(
              'flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-1.5 py-1 hover:bg-accent',
              isSelected && 'bg-accent',
            )}
          >
            <ColonistIcon status={colonist.status} canMove />
            {isSelected && (
              <>
                <span className="truncate font-mono text-[11px] text-foreground">
                  {colonist.label}
                </span>
                <span className="shrink-0 rounded-sm bg-primary/15 px-1 text-[11px] text-primary tabular-nums">
                  {files} {files === 1 ? 'file' : 'files'}
                </span>
              </>
            )}
          </button>
        )
      })}
    </nav>
  )
}
