import { BotIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
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
  // The overlays switched on.
  overlays: ReadonlySet<OverlayId>
  hasColonists: boolean
  isColonistPicked: boolean
  hasConflicts: boolean
  isOpen: boolean
  onToggle(): void
}

interface LegendGroup {
  title: string
  // The key that toggles its overlay.
  hotkey?: string | undefined
  rows: ReactNode[]
}

// The map's legend, floating at its top left: names and swatches for what is
// on the map now. The colonists' robots show while there are colonists; each
// overlay's group, titled with its key, shows only while it draws: Git while
// the overlay is on or a colonist is picked, Owners while its pins are on
// (with the possible-conflict badge while a file has one), Dependency while its lines
// or a selection's are drawn. The selection's outline is named with its lines,
// else on its own. Collapsed it is a small chip; L or a click toggles it.
export function MapLegend({
  lines,
  overlays,
  hasColonists,
  isColonistPicked,
  hasConflicts,
  isOpen,
  onToggle,
}: MapLegendProps) {
  const groups = listLegendGroups({
    lines,
    overlays,
    hasColonists,
    isColonistPicked,
    hasConflicts,
  })
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
              <h3 className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {group.title}
                {group.hotkey && <Kbd className="h-3.5 min-w-3.5 text-[9px]">{group.hotkey}</Kbd>}
              </h3>
              <ul className="space-y-0.5">{group.rows}</ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function listLegendGroups({
  lines,
  overlays,
  hasColonists,
  isColonistPicked,
  hasConflicts,
}: Omit<MapLegendProps, 'isOpen' | 'onToggle'>): LegendGroup[] {
  const groups: LegendGroup[] = []
  if (hasColonists) {
    groups.push({
      title: 'Colonists',
      rows: [
        <LegendRow key="robot" mark={<Robot />} name="Colonist" tip="On the file it saved last" />,
      ],
    })
  }
  const isGit = overlays.has('git')
  if (isGit || isColonistPicked) {
    groups.push({
      title: isGit ? 'Git' : 'Git · picked colonist',
      hotkey: overlayKey('git'),
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
      ],
    })
  }
  if (overlays.has('owners') && hasColonists) {
    const rows = [
      <LegendRow
        key="pin"
        mark={<Pin />}
        name="Owner"
        tip="A pin per changed file, in its colonist's colour"
      />,
    ]
    if (hasConflicts)
      rows.push(<LegendRow key="conflict" mark={<Conflict />} name="Possible conflict" />)
    groups.push({ title: 'Owners', hotkey: overlayKey('owners'), rows })
  }
  const dependency = OVERLAYS.find((overlay) => overlay.id === 'dependency') ?? OVERLAYS[0]
  const isDependency = lines.overlays.includes(dependency.id)
  if (isDependency || lines.isDirected) {
    const rows: ReactNode[] = []
    if (isDependency)
      rows.push(<LegendRow key="line" mark={<Arrow color={dependency.color} />} name="Import" />)
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
    if (lines.isDirected && lines.isSelected) rows.push(selectedRow)
    groups.push({ title: dependency.name, hotkey: dependency.key, rows })
  }
  if (lines.isSelected && !lines.isDirected)
    groups.push({ title: 'Selection', rows: [selectedRow] })
  return groups
}

const selectedRow = (
  <LegendRow
    key="selected"
    mark={
      <span className="size-3 rounded-[2px] border-2" style={{ borderColor: SELECTION_COLOR }} />
    }
    name="Selected"
  />
)

function overlayKey(id: OverlayId): string | undefined {
  return OVERLAYS.find((overlay) => overlay.id === id)?.key
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

function Robot() {
  return (
    <span
      className="flex size-4 items-center justify-center rounded-[4px] border"
      style={{ background: COLONIST_CHIP, borderColor: COLONIST_COLORS.working }}
    >
      <BotIcon className="size-3" strokeWidth={2.5} style={{ color: COLONIST_COLORS.working }} />
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
