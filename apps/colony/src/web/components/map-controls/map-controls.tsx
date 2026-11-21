import {
  LayersIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  Rotate3dIcon,
} from 'lucide-react'
import { Button } from '../ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx'

export interface MapControlsProps {
  isLeftCollapsed: boolean
  isRightCollapsed: boolean
  onToggleLeft(): void
  onToggleRight(): void
}

// Overlays arrive with the dependency overlay; until then the menu names
// them without letting them be switched.
const OVERLAYS = ['Dependencies', 'Calls', 'HTTP requests'] as const

// The header's right side: overlay filters, tilt and the panel toggles.
export function MapControls({
  isLeftCollapsed,
  isRightCollapsed,
  onToggleLeft,
  onToggleRight,
}: MapControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground">
            <LayersIcon />
            Overlays
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Overlays</DropdownMenuLabel>
          {OVERLAYS.map((overlay) => (
            <DropdownMenuCheckboxItem key={overlay} checked={false} disabled>
              {overlay}
            </DropdownMenuCheckboxItem>
          ))}
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            Overlay filters are not available yet. The map shows every dependency for now.
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
