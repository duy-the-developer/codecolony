import type { Edge, SymbolKind, WorldNode } from '../world/world-types.ts'

// The map's colours, shared by the canvas and the panels around it.

export const SYMBOL_COLORS: Record<SymbolKind, string> = {
  function: '#7cc6f2',
  method: '#93d3c9',
  class: '#f2b45c',
  interface: '#c4a7ff',
  type: '#dba6e0',
  enum: '#f2877f',
  variable: '#a9b98b',
  namespace: '#86b0a2',
}

export const EDGE_COLORS: Record<Edge['kind'], string> = {
  import: '#6aa8ff',
  call: '#4fd6c4',
  http: '#f2a33a',
  queue: '#b48cff',
  data: '#ef6f6c',
}

// Outlines around the selected nodes, and around the hovered one while
// nothing is selected.
export const SELECTION_COLOR = '#ffd166'
export const HOVER_COLOR = 'rgba(228, 237, 246, 0.85)'

const hues = new Map<string, number>()
// A stable hue per module, so a module's files share a colour and
// neighbouring modules tell apart at every zoom.
export function hueOf(node: WorldNode): number {
  const key = (node.kind === 'file' ? node.parent : undefined) ?? node.id
  let hue = hues.get(key)
  if (hue === undefined) {
    let hash = 2166136261
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
    hue = (hash >>> 0) % 360
    hues.set(key, hue)
  }
  return hue
}
