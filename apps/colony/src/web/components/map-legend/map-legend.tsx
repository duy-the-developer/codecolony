import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { type DrawnLines, OVERLAYS, type OverlayId } from '../../../modules/map/overlays.ts'
import {
  CHANGE_COLORS,
  COLONIST_CHIP,
  COLONIST_COLORS,
  CONFLICT_COLOR,
  DIRECTION_COLORS,
  SELECTION_COLOR,
} from '../../../modules/theme/palette.ts'
import { Kbd } from '../ui/kbd.tsx'

export interface MapLegendProps {
  lines: DrawnLines
  isOpen: boolean
  onToggle(): void
}

// What each overlay's lines are called.
const LINE_NAMES: Record<OverlayId, string> = {
  dependency: 'Import',
}

interface LegendGroup {
  title: string
  rows: ReactNode[]
}

// The map's legend, floating at its top left: names and swatches for what is
// on the map now. Colonist pins and change outlines are always listed; each
// overlay's group shows only while its lines are drawn, by the overlay or by
// a selection. Collapsed it is a small chip; L or a click toggles it.
export function MapLegend({ lines, isOpen, onToggle }: MapLegendProps) {
  const groups = listLegendGroups(lines)
  const Chevron = isOpen ? ChevronUpIcon : ChevronDownIcon
  return (
    <section
      aria-label="Map legend"
      className="pointer-events-auto w-fit rounded-md border bg-card/90 text-xs shadow-sm backdrop-blur-sm"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        title={isOpen ? 'Hide the legend (L)' : 'Show the legend (L)'}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
      >
        <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
          Legend
        </span>
        {!isOpen && <span className="text-muted-foreground">· {groups.length}</span>}
        <Kbd className="ml-auto h-4 min-w-4 text-[10px]">L</Kbd>
        <Chevron className="size-3.5 text-muted-foreground" />
      </button>
      {isOpen && (
        <div className="space-y-2 px-2 pt-0.5 pb-2">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-0.5 text-[11px] text-muted-foreground">{group.title}</h3>
              <ul className="space-y-0.5">{group.rows}</ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function listLegendGroups(lines: DrawnLines): LegendGroup[] {
  const groups: LegendGroup[] = [
    {
      title: 'Colonists',
      rows: [
        <LegendRow key="pin" mark={<Pin />} name="Pin" />,
        <LegendRow key="conflict" mark={<Conflict />} name="Possible conflict" />,
      ],
    },
    {
      title: 'Changes',
      rows: [
        <LegendRow
          key="modified"
          mark={<Dashed color={CHANGE_COLORS.modified} />}
          name="Modified"
        />,
        <LegendRow
          key="added"
          mark={<Dashed color={CHANGE_COLORS.added} />}
          name="Added"
          tip="Placeholder, sized by line count"
        />,
        <LegendRow key="removed" mark={<Dashed color={CHANGE_COLORS.removed} />} name="Removed" />,
        <LegendRow
          key="selected"
          mark={
            <span
              className="size-3 rounded-[2px] border-2"
              style={{ borderColor: SELECTION_COLOR }}
            />
          }
          name="Selected"
        />,
      ],
    },
  ]
  for (const overlay of OVERLAYS) {
    const isOn = lines.overlays.includes(overlay.id)
    if (!isOn && !lines.isDirected) continue
    const rows: ReactNode[] = []
    if (isOn) {
      rows.push(
        <LegendRow
          key="line"
          mark={<Arrow color={overlay.color} />}
          name={LINE_NAMES[overlay.id]}
        />,
      )
    }
    if (lines.isDirected) {
      rows.push(
        <LegendRow
          key="depends-on"
          mark={<Arrow color={DIRECTION_COLORS.dependsOn} />}
          name="Depends on"
        />,
        <LegendRow
          key="dependant"
          mark={<Arrow color={DIRECTION_COLORS.dependant} />}
          name="Dependants"
        />,
      )
    }
    groups.push({ title: overlay.name, rows })
  }
  return groups
}

interface LegendRowProps {
  mark: ReactNode
  name: string
  // A short explanation on hover, for a name that is not obvious.
  tip?: string
}

function LegendRow({ mark, name, tip }: LegendRowProps) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="flex h-4 w-7 shrink-0 items-center justify-center">
        {mark}
      </span>
      {tip ? (
        <span className="group relative">
          <button
            type="button"
            aria-describedby={`legend-tip-${name}`}
            className="cursor-help whitespace-nowrap underline decoration-dotted underline-offset-2"
          >
            {name}
          </button>
          <span
            id={`legend-tip-${name}`}
            role="tooltip"
            className="pointer-events-none absolute top-1/2 left-full z-10 ml-3 hidden w-max max-w-56 -translate-y-1/2 rounded-md border bg-popover px-2 py-1 text-popover-foreground shadow-md group-hover:block group-has-focus-visible:block"
          >
            {tip}
          </span>
        </span>
      ) : (
        <span className="whitespace-nowrap">{name}</span>
      )}
    </li>
  )
}

function Dashed({ color }: { color: string }) {
  return (
    <span
      className="size-3 rounded-[2px] border-[1.5px] border-dashed"
      style={{ borderColor: color }}
    />
  )
}

// A line ending in an arrowhead.
function Arrow({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 28 10" className="h-2.5 w-7" aria-hidden="true">
      <path d="M1 5H22" stroke={color} strokeWidth="1.5" />
      <path d="M27 5L21 1.5V8.5Z" fill={color} />
    </svg>
  )
}

function Pin() {
  return (
    <span
      className="rounded-full px-1 font-bold text-[9px] leading-3.5"
      style={{ background: COLONIST_COLORS.working, color: COLONIST_CHIP }}
    >
      CP
    </span>
  )
}

function Conflict() {
  return (
    <span
      className="flex size-3.5 items-center justify-center rounded-full font-extrabold text-[10px]"
      style={{ background: CONFLICT_COLOR, color: COLONIST_CHIP }}
    >
      !
    </span>
  )
}
