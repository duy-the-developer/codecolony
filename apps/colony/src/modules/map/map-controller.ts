import type { PlacedColonist } from '../scene/colonist-places.ts'
import type { Scene } from '../scene/scene.ts'
import type { WorldNode } from '../world/world-types.ts'
import { Camera, type Viewport } from './camera.ts'
import { ColonistLayer, keyOfHit, type MarkerHit } from './colonist-layer.ts'
import { buildFocus, type Focus, NO_FOCUS } from './focus.ts'
import { LaneLayer } from './lanes/lane-layer.ts'
import { createLaneRouter } from './lanes/lane-router.ts'
import { FILE_OPEN } from './lod.ts'
import type { DrawnLines, OverlayId } from './overlays.ts'
import { type Drawn, hitTest, hoverTarget, render } from './render.ts'
import {
  buildSelection,
  isMacPlatform,
  isToggleClick,
  listFocusIds,
  type SelectMode,
  sameSelection,
} from './selection.ts'

// The map: one canvas, drawn imperatively. React owns the page around it and
// talks to it through this handle; React never renders map nodes.

// The node under the pointer while something is selected, for its tooltip;
// x and y are relative to the canvas.
export interface MapHover {
  node: WorldNode
  x: number
  y: number
}

export interface MapControllerOptions {
  // The selection changed, by the map or a caller: the selected ids in the
  // order they were added, empty when cleared.
  onSelect(ids: readonly string[]): void
  // The pointer moved onto or off a node while something is selected.
  onHover(hover: MapHover | undefined): void
  // After each frame, for the zoom readout.
  onDraw(camera: Camera): void
  // The kinds of line drawn changed, for the legend.
  onLines?(lines: DrawnLines): void
  // A file or symbol was double-clicked: show its file.
  onOpen(id: string): void
  // A colonist was picked or let go, by its robot, one of its pins or a
  // caller.
  onSelectColonist(id: string | undefined): void
  // The canvas over the map that colonist robots and pins are drawn on, so
  // they can bob and pulse without redrawing the map.
  markerCanvas?: HTMLCanvasElement
}

export interface MapHandle {
  setScene(scene: Scene): void
  // Selects only this node (or clears the selection) and, with fly, frames it.
  select(id: string | undefined, fly?: boolean): void
  // The overlays drawn over the map; none by default.
  setOverlays(overlays: ReadonlySet<OverlayId>): void
  // The colonists to draw, placed on the current scene.
  setColonists(colonists: readonly PlacedColonist[]): void
  // Picks a colonist (or lets it go) and, with fly, frames all it touches.
  // Picking a colonist clears the node selection, and the other way round.
  selectColonist(id: string | undefined, fly?: boolean): void
  zoomBy(factor: number): void
  fitAll(): void
  // Redraws after the scene changed in place (edges merged).
  redraw(): void
  dispose(): void
}

export const ZOOM_STEP = 1.25
const PAN_STEP = 80
const CLICK_SLOP = 4
// Symbols are fetched when a file is this big on screen, half way to where
// they start to fade in, so they are there when they show.
const SYMBOL_PREFETCH_PX = FILE_OPEN[0] / 2

export function createMapController(
  canvas: HTMLCanvasElement,
  options: MapControllerOptions,
): MapHandle {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is not available')
  const ctx = context
  const markerCtx = options.markerCanvas?.getContext('2d') ?? undefined
  const colonists = new ColonistLayer()
  const stillness = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let markerFrame: number | undefined
  const camera = new Camera()
  let scene: Scene | undefined
  let drawn: Drawn[] = []
  let linesKey = ''
  let selected: readonly string[] = []
  let selectedSet: ReadonlySet<string> = new Set()
  // Grows with each selection change, so a selection that waits for symbols
  // gives way to a newer one.
  let selection = 0
  let hovered: string | undefined
  let tooltip: MapHover | undefined
  let overlays: ReadonlySet<OverlayId> = new Set()
  // The selected nodes, else the hovered one, with their subtrees.
  let focus: Focus = NO_FOCUS
  const isMac = isMacPlatform()
  const router = createLaneRouter()
  let lanes: LaneLayer | undefined
  let view: Viewport = { width: 0, height: 0 }
  let frame: number | undefined
  // The first world waits for the canvas to have a size before it is framed.
  let pendingFit: Scene | undefined
  let unsubscribe: (() => void) | undefined
  const centre = () => [view.width / 2, view.height / 2] as const

  function requestDraw(): void {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!scene) return
      const result = render(ctx, scene, camera, view, {
        selected: selectedSet,
        focus,
        overlays,
        colonists,
        ...(lanes ? { lanes } : {}),
      })
      drawn = result.drawn
      const key = `${result.lines.overlays.join(',')}|${result.lines.isDirected}|${result.lines.isSelected}`
      if (key !== linesKey) {
        linesKey = key
        options.onLines?.(result.lines)
      }
      prefetchSymbols(scene)
      requestMarkerDraw()
      options.onDraw(camera)
    })
  }

  // Robots and pins redraw on their own canvas, every frame while one moves.
  function requestMarkerDraw(): void {
    if (!markerCtx || markerFrame !== undefined) return
    markerFrame = requestAnimationFrame((now) => {
      markerFrame = undefined
      const isStill = stillness?.matches ?? false
      colonists.drawMarkers(markerCtx, view, now, isStill)
      if (colonists.isAnimated && !isStill) requestMarkerDraw()
    })
  }

  // Loads the symbols of files about to open; the scene redraws when they come.
  function prefetchSymbols(current: Scene): void {
    const files: WorldNode[] = []
    for (const item of drawn) {
      if (item.node.kind !== 'file' || Math.min(item.w, item.h) < SYMBOL_PREFETCH_PX) continue
      if (current.needsSymbols(item.node)) files.push(item.node)
    }
    if (files.length > 0) void current.loadSymbols(files)
  }

  function resize(): void {
    const ratio = window.devicePixelRatio || 1
    view = { width: canvas.clientWidth, height: canvas.clientHeight }
    canvas.width = Math.round(view.width * ratio)
    canvas.height = Math.round(view.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (markerCtx && options.markerCanvas) {
      options.markerCanvas.width = canvas.width
      options.markerCanvas.height = canvas.height
      markerCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    if (pendingFit && view.width > 0 && view.height > 0) frameFirstScene(pendingFit)
    requestDraw()
  }

  // Frames the whole map, or the node named by `?go=` and selects it.
  function frameFirstScene(first: Scene): void {
    pendingFit = undefined
    if (!first.root) return
    const go = new URLSearchParams(location.search).get('go')
    camera.fit(first.root.rect, view)
    if (!go) return
    void first.ensureNode(go).then((target) => {
      if (!target || scene !== first) return
      camera.fit(target.rect, view)
      select(target.id)
    })
  }

  // Points the focus at the selected nodes, else the hovered one.
  function updateFocus(): void {
    const ids = listFocusIds(selected, hovered)
    if (ids.join('\n') === focus.key) return
    focus = scene ? buildFocus(scene, ids) : NO_FOCUS
    requestDraw()
  }

  // target: what the pointer puts in focus while nothing is selected; tip:
  // what it names in the tooltip while something is.
  function hover(target: string | undefined, tip?: MapHover): void {
    showTooltip(selected.length > 0 ? tip : undefined)
    if (target === hovered) return
    hovered = target
    updateFocus()
  }

  function showTooltip(next: MapHover | undefined): void {
    if (!next && !tooltip) return
    tooltip = next
    options.onHover(next)
  }

  function select(id: string | undefined, fly = false): void {
    selectIds(buildSelection(selected, id, 'replace'), fly ? id : undefined)
  }

  function clickNode(id: string | undefined, mode: SelectMode): void {
    selectIds(buildSelection(selected, id, mode))
  }

  // Makes these ids the selection, in order, and flies to `fly` if given.
  // Symbols whose file's symbols are not loaded yet are loaded first; ids not
  // on the map are dropped.
  function selectIds(ids: readonly string[], fly?: string): void {
    const current = scene
    const request = ++selection
    const missing = current
      ? ids.filter((id) => !current.byId.has(id) && current.fileIdOf(id) !== undefined)
      : []
    if (current && missing.length > 0) {
      void Promise.all(missing.map((id) => current.ensureNode(id))).then(() => {
        if (scene !== current || request !== selection) return
        selectIds(
          ids.filter((id) => current.byId.has(id)),
          fly,
        )
      })
      return
    }
    const next = [...new Set(ids.filter((id) => current?.byId.has(id)))]
    const changed = !sameSelection(next, selected)
    selected = next
    selectedSet = new Set(next)
    if (next.length > 0 && colonists.selected) selectColonist(undefined)
    const target = fly ? current?.byId.get(fly) : undefined
    if (target) camera.flyTo(target.rect, view, requestDraw)
    if (next.length === 0) showTooltip(undefined)
    updateFocus()
    if (changed) options.onSelect(selected)
    requestDraw()
  }

  function selectColonist(id: string | undefined, fly = false): void {
    const next = id && colonists.has(id) ? id : undefined
    const changed = next !== colonists.selected
    colonists.selected = next
    if (next && selected.length > 0) select(undefined)
    const bounds = next ? colonists.boundsOf(next) : undefined
    if (bounds && fly) camera.flyTo(bounds, view, requestDraw)
    if (changed) options.onSelectColonist(next)
    requestDraw()
  }

  function hoverMarker(hit: MarkerHit | undefined): void {
    const before = colonists.hovered
    if ((hit && keyOfHit(hit)) === (before && keyOfHit(before))) return
    colonists.hovered = hit
    requestMarkerDraw()
  }

  // A robot or pin picks its colonist (with fly, frames all it touches); a
  // possible-conflict badge selects its block, so the Inspector lists the
  // colonists changing it.
  function clickMarker(hit: MarkerHit, fly: boolean): void {
    if (hit.kind !== 'conflict') selectColonist(hit.colonistId, fly)
    else select(hit.badge.nodeId, fly)
  }

  function setScene(next: Scene): void {
    const first = scene === undefined
    scene = next
    lanes = new LaneLayer(next, router, requestDraw)
    // Node ids may be gone or reused: work the focus out afresh.
    focus = NO_FOCUS
    unsubscribe?.()
    unsubscribe = next.subscribe(() => {
      // New symbols can be in focus, or hold its edges.
      focus = NO_FOCUS
      updateFocus()
      requestDraw()
    })
    if (hovered && !next.byId.has(hovered)) hovered = undefined
    if (tooltip && next.byId.get(tooltip.node.id) !== tooltip.node) showTooltip(undefined)
    // Keep the selection across world versions while its nodes still exist.
    selectIds(selected)
    if (!first) return
    pendingFit = next
    if (view.width > 0 && view.height > 0) frameFirstScene(next)
  }

  // Input: wheel and pinch zoom at the cursor, drag pans, click selects (with
  // Cmd, or Ctrl off a Mac, it adds or removes), double-click flies in (and
  // opens a file), +/- and arrows work from the keyboard, Escape clears.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1
    // Trackpad pinches arrive as wheel events with ctrlKey set.
    const speed = event.ctrlKey ? 0.01 : 0.0015
    camera.zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * unit * speed))
    // The blocks move under the pointer; the next move names the new one.
    showTooltip(undefined)
    hoverMarker(undefined)
    requestDraw()
  }

  const pointers = new Map<number, { x: number; y: number }>()
  let dragDistance = 0
  const onPointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
    dragDistance = 0
    showTooltip(undefined)
  }
  const onPointerMove = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId)
    if (!last) {
      const marker = colonists.hitMarker(event.offsetX, event.offsetY)
      hoverMarker(marker)
      const hit = marker ? undefined : hitTest(drawn, event.offsetX, event.offsetY)
      canvas.style.cursor = marker || hit ? 'pointer' : 'default'
      const target = scene && hit ? hoverTarget(scene, hit) : undefined
      // A symbol names itself in the tooltip; other blocks only where they
      // would put themselves in focus.
      const node =
        hit?.node.kind === 'symbol' ? hit.node : target ? scene?.byId.get(target) : undefined
      hover(target, node && { node, x: event.offsetX, y: event.offsetY })
      return
    }
    const next = { x: event.offsetX, y: event.offsetY }
    if (pointers.size === 2) {
      // Two-finger pinch on touch screens.
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
      if (other) {
        const before = Math.hypot(last.x - other.x, last.y - other.y)
        const after = Math.hypot(next.x - other.x, next.y - other.y)
        if (before > 0)
          camera.zoomAt((next.x + other.x) / 2, (next.y + other.y) / 2, after / before)
      }
    } else {
      camera.panBy(next.x - last.x, next.y - last.y)
    }
    dragDistance += Math.hypot(next.x - last.x, next.y - last.y)
    pointers.set(event.pointerId, next)
    requestDraw()
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return
    if (pointers.size === 0 && dragDistance < CLICK_SLOP) {
      const marker = colonists.hitMarker(event.offsetX, event.offsetY)
      if (marker) {
        clickMarker(marker, false)
        return
      }
      const id = hitTest(drawn, event.offsetX, event.offsetY)?.node.id
      clickNode(id, isToggleClick(event, isMac) ? 'toggle' : 'replace')
      if (colonists.selected) selectColonist(undefined)
    }
  }
  const onPointerCancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
  }
  const onPointerLeave = () => {
    hover(undefined)
    hoverMarker(undefined)
  }
  const onDoubleClick = (event: MouseEvent) => {
    const marker = colonists.hitMarker(event.offsetX, event.offsetY)
    if (marker) {
      clickMarker(marker, true)
      return
    }
    const hit = hitTest(drawn, event.offsetX, event.offsetY)
    if (!hit || isToggleClick(event, isMac)) return
    select(hit.node.id, true)
    if (hit.node.kind === 'file' || hit.node.kind === 'symbol') options.onOpen(hit.node.id)
  }

  // Map keys work while nothing else on the page has the focus, so arrows
  // still move between tabs and type in the terminal.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.target !== document.body && event.target !== canvas) return
    switch (event.key) {
      case '+':
      case '=':
        camera.zoomAt(...centre(), ZOOM_STEP)
        break
      case '-':
      case '_':
        camera.zoomAt(...centre(), 1 / ZOOM_STEP)
        break
      case 'ArrowLeft':
        camera.panBy(PAN_STEP, 0)
        break
      case 'ArrowRight':
        camera.panBy(-PAN_STEP, 0)
        break
      case 'ArrowUp':
        camera.panBy(0, PAN_STEP)
        break
      case 'ArrowDown':
        camera.panBy(0, -PAN_STEP)
        break
      case 'Home':
        if (scene?.root) camera.flyTo(scene.root.rect, view, requestDraw)
        break
      case 'Escape':
        select(undefined)
        selectColonist(undefined)
        break
      default:
        return
    }
    event.preventDefault()
    requestDraw()
  }

  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('dblclick', onDoubleClick)
  window.addEventListener('keydown', onKeyDown)
  const resizer = new ResizeObserver(resize)
  resizer.observe(canvas)
  resize()

  return {
    setScene,
    select,
    setOverlays(next) {
      overlays = next
      colonists.showGit = next.has('git')
      colonists.showOwners = next.has('owners')
      requestDraw()
    },
    setColonists(next) {
      const before = colonists.selected
      colonists.setColonists(next)
      if (before !== colonists.selected) options.onSelectColonist(colonists.selected)
      requestDraw()
    },
    selectColonist,
    zoomBy(factor) {
      camera.zoomAt(...centre(), factor)
      requestDraw()
    },
    fitAll() {
      if (scene?.root) camera.flyTo(scene.root.rect, view, requestDraw)
    },
    redraw: requestDraw,
    dispose() {
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (markerFrame !== undefined) cancelAnimationFrame(markerFrame)
      unsubscribe?.()
      resizer.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      router.dispose()
      canvas.removeEventListener('dblclick', onDoubleClick)
    },
  }
}
