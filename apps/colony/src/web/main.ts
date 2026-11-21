import type { ProjectsResponse } from '../shared/api.ts'
import type { DeepResponse, World, WorldNode } from '../shared/world.ts'
import { Camera, type Viewport } from './camera.ts'
import { renderInspector } from './inspector.ts'
import { type Drawn, hitTest, render } from './render.ts'
import { Scene } from './scene.ts'

const ZOOM_STEP = 1.25
const PAN_STEP = 80
const CLICK_SLOP = 4

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`index.html is missing ${selector}`)
  return found
}

const canvas = element<HTMLCanvasElement>('#canvas')
const inspector = element<HTMLElement>('#inspector')
const hud = element<HTMLElement>('#hud')
const projectList = element<HTMLUListElement>('#projects')
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

function requestDraw(): void {
  if (frame !== undefined) return
  frame = requestAnimationFrame(() => {
    frame = undefined
    if (!scene) return
    drawn = render(ctx, scene, camera, view, { selected, selectedSubtree: subtree })
    updateHud()
  })
}

function resize(): void {
  const ratio = window.devicePixelRatio || 1
  view = { width: canvas.clientWidth, height: canvas.clientHeight }
  canvas.width = Math.round(view.width * ratio)
  canvas.height = Math.round(view.height * ratio)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  requestDraw()
}

function select(id: string | undefined, fly = false): void {
  const node = id ? scene?.byId.get(id) : undefined
  selected = node?.id
  subtree = new Set()
  if (node && scene) {
    const stack = [node]
    for (let n = stack.pop(); n; n = stack.pop()) {
      subtree.add(n.id)
      stack.push(...(scene.children.get(n.id) ?? []))
    }
    if (fly) camera.flyTo(node.rect, view, requestDraw)
  }
  if (scene)
    renderInspector(inspector, scene, node, subtree, {
      select: (next) => select(next, true),
      trace,
    })
  requestDraw()
}

async function trace(file: WorldNode): Promise<void> {
  const response = await fetch(`/api/deep?file=${encodeURIComponent(file.id)}`)
  const body = (await response.json()) as DeepResponse | { error: string }
  if ('error' in body) throw new Error(body.error)
  scene?.mergeEdges(body.edges)
  select(file.id)
}

async function loadWorld(): Promise<void> {
  const world = (await (await fetch('/api/world')).json()) as World
  if (scene && world.version <= scene.world.version) return
  const first = scene === undefined
  scene = new Scene(world)
  if (first && scene.root) {
    const go = new URLSearchParams(location.search).get('go')
    const target = (go && scene.byId.get(go)) || scene.root
    camera.fit(target.rect, view)
    if (go && target !== scene.root) select(target.id)
  }
  select(selected)
}

async function loadProjects(): Promise<void> {
  const { projects } = (await (await fetch('/api/projects')).json()) as ProjectsResponse
  projectList.replaceChildren(
    ...projects.map(({ name, kind }) => {
      const item = document.createElement('li')
      item.textContent = `${name} (${kind})`
      return item
    }),
  )
}

function updateHud(): void {
  if (!scene) return
  const repos = scene.world.nodes.filter((n) => n.kind === 'repo')
  const commits = repos.map((r) => `${r.name} @ ${r.commit?.slice(0, 7) ?? 'empty'}`).join(', ')
  const time = scene.world.indexedAt ? new Date(scene.world.indexedAt).toLocaleTimeString() : ''
  hud.textContent = `Live · ${commits} · indexed ${time} · zoom ×${camera.scale.toPrecision(3)}`
}

// Input: wheel and pinch zoom at the cursor, drag pans, click selects,
// double-click flies in, +/- and arrows work from the keyboard.
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1
    // Trackpad pinches arrive as wheel events with ctrlKey set.
    const speed = event.ctrlKey ? 0.01 : 0.0015
    camera.zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * unit * speed))
    requestDraw()
  },
  { passive: false },
)

const pointers = new Map<number, { x: number; y: number }>()
let dragDistance = 0
canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
  dragDistance = 0
})
canvas.addEventListener('pointermove', (event) => {
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
      if (before > 0) camera.zoomAt((next.x + other.x) / 2, (next.y + other.y) / 2, after / before)
    }
  } else {
    camera.panBy(next.x - last.x, next.y - last.y)
  }
  dragDistance += Math.hypot(next.x - last.x, next.y - last.y)
  pointers.set(event.pointerId, next)
  requestDraw()
})
const release = (event: PointerEvent) => {
  if (!pointers.delete(event.pointerId)) return
  if (pointers.size === 0 && dragDistance < CLICK_SLOP) {
    select(hitTest(drawn, event.offsetX, event.offsetY)?.node.id)
  }
}
canvas.addEventListener('pointerup', release)
canvas.addEventListener('pointercancel', (event) => pointers.delete(event.pointerId))
canvas.addEventListener('dblclick', (event) => {
  const hit = hitTest(drawn, event.offsetX, event.offsetY)
  if (hit) select(hit.node.id, true)
})

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
    return
  const centre = [view.width / 2, view.height / 2] as const
  switch (event.key) {
    case '+':
    case '=':
      camera.zoomAt(...centre, ZOOM_STEP)
      break
    case '-':
    case '_':
      camera.zoomAt(...centre, 1 / ZOOM_STEP)
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
})

new ResizeObserver(resize).observe(canvas)
resize()

// Live: the server announces each new world version.
const events = new EventSource('/api/events')
events.addEventListener('world', () => {
  loadWorld().catch((error: unknown) => console.error('Could not load the world', error))
})
loadProjects().catch((error: unknown) => console.error('Could not load projects', error))
