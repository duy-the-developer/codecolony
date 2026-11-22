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

// Colonists, by status: blue while a session is on it (blue means "being
// changed", like the modified outline), amber when it waits on you, red when
// it stopped, green with a pull request, grey with no live session.
export const COLONIST_COLORS = {
  working: '#4f9fe8',
  paused: '#4f9fe8',
  waiting: '#f7a21b',
  blocked: '#e05050',
  error: '#e05050',
  'pr-ready': '#3ecf8e',
  idle: '#8a99a8',
} as const satisfies Record<string, string>

// Diff outlines: modified files, the placeholders of added ones, removed ones.
export const CHANGE_COLORS = {
  modified: '#4f9fe8',
  added: '#3ecf8e',
  removed: '#e05050',
} as const satisfies Record<string, string>

// The dark line under a diff outline, so it reads on any fill.
export const CHANGE_CASING = 'rgba(8, 16, 26, 0.85)'
// The veil over a removed file.
export const REMOVED_VEIL = 'rgba(8, 16, 26, 0.45)'
// The colonist marker's chip and its hover label.
export const COLONIST_CHIP = '#0b1724'
export const COLONIST_INK = '#e4edf6'
