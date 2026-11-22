import { type ReactNode, type RefObject, useEffect, useRef } from 'react'
import type { Camera } from '../../../modules/map/camera.ts'
import {
  createMapController,
  type MapHandle,
  type MapHover,
} from '../../../modules/map/map-controller.ts'
import type { OverlayId } from '../../../modules/map/overlays.ts'
import type { Scene } from '../../../modules/scene/scene.ts'

export interface MapViewProps {
  scene: Scene | undefined
  // Filled with the map's handle while the view is mounted.
  handleRef: RefObject<MapHandle | null>
  overlays: ReadonlySet<OverlayId>
  // The selected ids, in the order they were added.
  onSelect(ids: readonly string[]): void
  // A file or symbol was double-clicked.
  onOpen(id: string): void
  // Overlays drawn over the canvas: breadcrumb, zoom buttons.
  children?: ReactNode
}

// The canvas map. The renderer stays imperative; this component only owns its
// lifetime, the zoom readout and the hover tooltip, which it writes directly
// every frame or pointer move.
export function MapView({ scene, handleRef, overlays, onSelect, onOpen, children }: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const overlaysRef = useRef(overlays)
  overlaysRef.current = overlays
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handle = createMapController(canvas, {
      onSelect: (ids) => onSelectRef.current(ids),
      onHover: (hover) => {
        if (tooltipRef.current) placeTooltip(tooltipRef.current, hover)
      },
      onOpen: (id) => onOpenRef.current(id),
      onDraw: (camera) => {
        if (hudRef.current && sceneRef.current)
          hudRef.current.textContent = hudText(sceneRef.current, camera)
      },
    })
    handleRef.current = handle
    handle.setOverlays(overlaysRef.current)
    if (sceneRef.current) handle.setScene(sceneRef.current)
    return () => {
      handle.dispose()
      handleRef.current = null
    }
  }, [handleRef])

  useEffect(() => {
    if (scene) handleRef.current?.setScene(scene)
  }, [scene, handleRef])

  useEffect(() => {
    handleRef.current?.setOverlays(overlays)
  }, [overlays, handleRef])

  return (
    <div className="relative h-full min-w-0 overflow-hidden bg-[#0d1b2a]">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Code map"
        className="absolute inset-0 size-full touch-none outline-none"
      />
      {!scene && (
        <p className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          Indexing...
        </p>
      )}
      <div
        ref={hudRef}
        aria-live="polite"
        className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-4.5rem)] rounded-md border bg-card/85 px-2 py-1 text-muted-foreground text-xs"
      />
      <div
        ref={tooltipRef}
        role="tooltip"
        hidden
        className="pointer-events-none absolute top-0 left-0 max-w-64 truncate rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
      />
      {children}
    </div>
  )
}

// Pointer offset of the tooltip, in pixels.
const TOOLTIP_GAP_PX = 14

// Shows the hovered node's name and kind beside the pointer, on the side with
// room.
function placeTooltip(element: HTMLDivElement, hover: MapHover | undefined): void {
  element.hidden = !hover
  if (!hover) return
  const { node } = hover
  const kind = node.kind === 'symbol' ? (node.symbolKind ?? 'symbol') : node.kind
  element.textContent = `${node.name} · ${kind}`
  const parent = element.parentElement
  const isRight = !parent || hover.x < parent.clientWidth - element.offsetWidth - 2 * TOOLTIP_GAP_PX
  const isBelow =
    !parent || hover.y < parent.clientHeight - element.offsetHeight - 2 * TOOLTIP_GAP_PX
  const x = isRight ? hover.x + TOOLTIP_GAP_PX : hover.x - TOOLTIP_GAP_PX - element.offsetWidth
  const y = isBelow ? hover.y + TOOLTIP_GAP_PX : hover.y - TOOLTIP_GAP_PX - element.offsetHeight
  element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
}

function hudText(scene: Scene, camera: Camera): string {
  const repos = scene.world.nodes.filter((n) => n.kind === 'repo')
  const commits = repos.map((r) => `${r.name} @ ${r.commit?.slice(0, 7) ?? 'empty'}`).join(', ')
  const time = scene.world.indexedAt ? new Date(scene.world.indexedAt).toLocaleTimeString() : ''
  return `Live · ${commits} · indexed ${time} · zoom ×${camera.scale.toPrecision(3)}`
}
