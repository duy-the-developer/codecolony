import { MaximizeIcon, MinusIcon, PlusIcon } from 'lucide-react'
import { Button } from '../ui/button.tsx'

export interface ZoomControlsProps {
  onZoomIn(): void
  onZoomOut(): void
  onFitAll(): void
}

export function ZoomControls({ onZoomIn, onZoomOut, onFitAll }: ZoomControlsProps) {
  return (
    <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-md border bg-card/90">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={onZoomIn}
      >
        <PlusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Zoom out"
        title="Zoom out (-)"
        onClick={onZoomOut}
      >
        <MinusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Show the whole map"
        title="Show the whole map (Home)"
        onClick={onFitAll}
      >
        <MaximizeIcon className="size-3.5" />
      </Button>
    </div>
  )
}
