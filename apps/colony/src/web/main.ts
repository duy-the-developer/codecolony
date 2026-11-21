import type { ProjectsResponse } from '../shared/api.ts'

const GRID = 24

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')
const projectList = document.querySelector<HTMLUListElement>('#projects')
if (!canvas || !projectList) throw new Error('index.html is missing #canvas or #projects')
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('2D canvas is not available')

// Placeholder until the renderer lands: a blueprint grid sized to the panel.
function draw(): void {
  if (!canvas || !ctx) return
  const ratio = window.devicePixelRatio || 1
  const { clientWidth: width, clientHeight: height } = canvas
  canvas.width = width * ratio
  canvas.height = height * ratio
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid')
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0.5; x < width; x += GRID) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  for (let y = 0.5; y < height; y += GRID) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
}

async function loadProjects(): Promise<void> {
  if (!projectList) return
  const response = await fetch('/api/projects')
  const { projects } = (await response.json()) as ProjectsResponse
  projectList.replaceChildren(
    ...projects.map(({ name, kind }) => {
      const item = document.createElement('li')
      item.textContent = `${name} (${kind})`
      return item
    }),
  )
}

new ResizeObserver(draw).observe(canvas)
loadProjects().catch((error: unknown) => console.error('Could not load projects', error))
