import { COLONIST_STATUS_TEXT } from '../../../modules/theme/colonist-glyphs.ts'
import type { Colonist } from '../../../modules/wire/api-types.ts'
import { ColonistIcon } from '../colonist-icon/colonist-icon.tsx'
import { cn } from '../ui/class-names.ts'

export interface ColonistRosterProps {
  colonists: readonly Colonist[]
  selectedId: string | undefined
  onPick(id: string): void
}

// The colonists at a glance, over the map's top right corner: one robot per
// colonist; the picked one shows its name. Absent with no colonists.
export function ColonistRoster({ colonists, selectedId, onPick }: ColonistRosterProps) {
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
              <span className="truncate font-mono text-[11px] text-foreground">
                {colonist.label}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
