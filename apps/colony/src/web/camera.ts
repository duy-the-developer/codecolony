import type { Rect } from '../shared/world-types.ts'

// A continuous 2D camera, like a web map: scroll, pinch and keys change the
// scale smoothly; the renderer decides what to show from the scale alone.

export interface Viewport {
  width: number
  height: number
}

export const MIN_SCALE = 0.02
export const MAX_SCALE = 4000

export class Camera {
  // World point at the top left of the screen, and pixels per world unit.
  x = 0
  y = 0
  scale = 1
  private animation: number | undefined

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.scale, (wy - this.y) * this.scale]
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.x + sx / this.scale, this.y + sy / this.scale]
  }

  // Zooms by a factor while keeping the world point under (sx, sy) in place.
  zoomAt(sx: number, sy: number, factor: number): void {
    this.stop()
    const [wx, wy] = this.toWorld(sx, sy)
    this.scale = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE)
    this.x = wx - sx / this.scale
    this.y = wy - sy / this.scale
  }

  panBy(dx: number, dy: number): void {
    this.stop()
    this.x -= dx / this.scale
    this.y -= dy / this.scale
  }

  // The camera that shows rect centred with a margin.
  framing(rect: Rect, view: Viewport, margin = 0.1): { x: number; y: number; scale: number } {
    const usable = 1 - 2 * margin
    const scale = clamp(
      Math.min((view.width * usable) / rect.w, (view.height * usable) / rect.h),
      MIN_SCALE,
      MAX_SCALE,
    )
    return {
      x: rect.x + rect.w / 2 - view.width / 2 / scale,
      y: rect.y + rect.h / 2 - view.height / 2 / scale,
      scale,
    }
  }

  fit(rect: Rect, view: Viewport): void {
    this.stop()
    Object.assign(this, this.framing(rect, view))
  }

  // Animates to a framing; the scale moves in log space so the zoom feels even.
  flyTo(rect: Rect, view: Viewport, onFrame: () => void, durationMs = 450): void {
    this.stop()
    const from = { x: this.x, y: this.y, scale: this.scale }
    const to = this.framing(rect, view)
    const centre = (c: { x: number; y: number; scale: number }) => ({
      cx: c.x + view.width / 2 / c.scale,
      cy: c.y + view.height / 2 / c.scale,
    })
    const a = centre(from)
    const b = centre(to)
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1)
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      this.scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e)
      const cx = a.cx + (b.cx - a.cx) * e
      const cy = a.cy + (b.cy - a.cy) * e
      this.x = cx - view.width / 2 / this.scale
      this.y = cy - view.height / 2 / this.scale
      onFrame()
      this.animation = t < 1 ? requestAnimationFrame(step) : undefined
    }
    this.animation = requestAnimationFrame(step)
  }

  private stop(): void {
    if (this.animation !== undefined) cancelAnimationFrame(this.animation)
    this.animation = undefined
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
