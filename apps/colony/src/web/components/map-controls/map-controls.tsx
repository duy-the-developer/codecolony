import {
  LayersIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  Rotate3dIcon,
} from 'lucide-react'
import { cn } from '../../class-names.ts'
import { OVERLAYS, type OverlayId, PLANNED_OVERLAYS } from '../../overlays.ts'
import { Button } from '../ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx'
import { Kbd } from '../ui/kbd.tsx'

export interface MapControlsProps {
  isLeftCollapsed: boolean
  isRightCollapsed: boolean
  onToggleLeft(): void
  onToggleRight(): void
  // The overlays switched on.
  overlays: ReadonlySet<OverlayId>
  onToggleOverlay(id: OverlayId): void
}

// The header's right side: overlay filters, tilt and the panel toggles.
export function MapControls({
  isLeftCollapsed,
  isRightCollapsed,
  onToggleLeft,
  onToggleRight,
  overlays,
  onToggleOverlay,
}: MapControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-8 gap-1.5', overlays.size === 0 && 'text-muted-foreground')}
          >
            <LayersIcon />
            Overlays
            {overlays.size > 0 && (
              <span className="rounded-sm bg-primary/15 px-1 text-primary text-xs">
                {overlays.size}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Overlays</DropdownMenuLabel>
          {OVERLAYS.map((overlay) => (
            <DropdownMenuCheckboxItem
              key={overlay.id}
              checked={overlays.has(overlay.id)}
              onCheckedChange={() => onToggleOverlay(overlay.id)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="h-0.5 w-4 rounded-full" style={{ background: overlay.color }} />
              {overlay.name}
              <Kbd className="ml-auto">D</Kbd>
            </DropdownMenuCheckboxItem>
          ))}
          {PLANNED_OVERLAYS.map((name) => (
            <DropdownMenuCheckboxItem key={name} checked={false} disabled>
              {name}
              <span className="ml-auto text-xs">later</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            With no overlay on, hover a module or file to see its connections.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <span title="Tilt is not available yet">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" disabled>
          <Rotate3dIcon />
          Tilt
        </Button>
      </span>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button
        variant="ghost"
        size="icon"
        aria-label={isLeftCollapsed ? 'Show left panel' : 'Hide left panel'}
        aria-pressed={!isLeftCollapsed}
        title={`${isLeftCollapsed ? 'Show' : 'Hide'} left panel ( [ )`}
        onClick={onToggleLeft}
      >
        {isLeftCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={isRightCollapsed ? 'Show right panel' : 'Hide right panel'}
        aria-pressed={!isRightCollapsed}
        title={`${isRightCollapsed ? 'Show' : 'Hide'} right panel ( ] )`}
        onClick={onToggleRight}
      >
        {isRightCollapsed ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
      </Button>
    </div>
  )
}
