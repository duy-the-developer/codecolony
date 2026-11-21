import type { WorldNode } from '../shared/world-types.ts'
import { Camera, type Viewport } from './camera.ts'
import { type Drawn, hitTest, render } from './render.ts'
import type { Scene } from './scene.ts'

// The map: one canvas, drawn imperatively. React owns the page around it and
// talks to it through this handle; React never renders map nodes.

export interface MapControllerOptions {
  // A node was selected or the selection was cleared, by the map or a caller.
  onSelect(id: string | undefined): void
  // After each frame, for the zoom readout.
  onDraw(camera: Camera): void
  // A file or symbol was double-clicked: show its file.
  onOpen(id: string): void
}

export interface MapHandle {
  setScene(scene: Scene): void
  // Selects a node (or clears the selection) and, with fly, frames it.
  select(id: string | undefined, fly?: boolean): void
  zoomBy(factor: number): void
  fitAll(): void
  // Redraws after the scene changed in place (edges merged).
  redraw(): void
  dispose(): void
}

export const ZOOM_STEP = 1.25
const PAN_STEP = 80
const CLICK_SLOP = 4

export function createMapController(
  canvas: HTMLCanvasElement,
  options: MapControllerOptions,
): MapHandle {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is not available')
  const ctx = context
  const camera = new Camera()
  let scene: Scene | undefined
  let drawn: Drawn[] = []
  let selected: string | undefined
  let subtree: Set<string> = new Set()
  let view: Viewport = { width: 0, height: 0 }
  let frame: number | undefined
  // The first world waits for the canvas to have a size before it is framed.
  let pendingFit: Scene | undefined
  const centre = () => [view.width / 2, view.height / 2] as const

  function requestDraw(): void {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!scene) return
      drawn = render(ctx, scene, camera, view, { selected, selectedSubtree: subtree })
      options.onDraw(camera)
    })
  }

  function resize(): void {
    const ratio = window.devicePixelRatio || 1
    view = { width: canvas.clientWidth, height: canvas.clientHeight }
    canvas.width = Math.round(view.width * ratio)
    canvas.height = Math.round(view.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (pendingFit && view.width > 0 && view.height > 0) frameFirstScene(pendingFit)
    requestDraw()
  }

  // Frames the whole map, or the node named by `?go=` and selects it.
  function frameFirstScene(first: Scene): void {
    pendingFit = undefined
    if (!first.root) return
    const go = new URLSearchParams(location.search).get('go')
    const target = (go && first.byId.get(go)) || first.root
    camera.fit(target.rect, view)
    if (go && target !== first.root) select(target.id)
  }

  function select(id: string | undefined, fly = false): void {
    const node = id ? scene?.byId.get(id) : undefined
    const changed = node?.id !== selected
    selected = node?.id
    subtree = new Set()
    if (node && scene) {
      const stack: WorldNode[] = [node]
      for (let n = stack.pop(); n; n = stack.pop()) {
        subtree.add(n.id)
        stack.push(...(scene.children.get(n.id) ?? []))
      }
      if (fly) camera.flyTo(node.rect, view, requestDraw)
    }
    if (changed) options.onSelect(selected)
    requestDraw()
  }

  function setScene(next: Scene): void {
    const first = scene === undefined
    scene = next
    // Keep the selection across world versions while its node still exists.
    select(selected)
    if (!first) return
    pendingFit = next
    if (view.width > 0 && view.height > 0) frameFirstScene(next)
  }

  // Input: wheel and pinch zoom at the cursor, drag pans, click selects,
  // double-click flies in (and opens a file), +/- and arrows work from the
  // keyboard.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1
    // Trackpad pinches arrive as wheel events with ctrlKey set.
    const speed = event.ctrlKey ? 0.01 : 0.0015
    camera.zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * unit * speed))
    requestDraw()
  }

  const pointers = new Map<number, { x: number; y: number }>()
  let dragDistance = 0
  const onPointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
    dragDistance = 0
  }
  const onPointerMove = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId)
    if (!last) {
      canvas.style.cursor = hitTest(drawn, event.offsetX, event.offsetY) ? 'pointer' : 'default'
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
      select(hitTest(drawn, event.offsetX, event.offsetY)?.node.id)
    }
  }
  const onPointerCancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
  }
  const onDoubleClick = (event: MouseEvent) => {
    const hit = hitTest(drawn, event.offsetX, event.offsetY)
    if (!hit) return
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
  canvas.addEventListener('dblclick', onDoubleClick)
  window.addEventListener('keydown', onKeyDown)
  const resizer = new ResizeObserver(resize)
  resizer.observe(canvas)
  resize()

  return {
    setScene,
    select,
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
      resizer.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('dblclick', onDoubleClick)
    },
  }
}
