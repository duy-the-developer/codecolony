import type { ChangeKind, Colonist } from '../wire/api-types.ts'
import { HEADER_UNITS, type Rect, type WorldNode } from '../world/world-types.ts'
import type { Scene } from './scene.ts'

// Where each colonist's changes land on the map. A modified or removed file
// is its own square. An added file is not on the map yet (the map shows
// committed code), so it gets a placeholder square, sized by its line count,
// in the first free spot of the folder it is added to. Files added in a new
// folder share one placeholder box for that folder, one small square each.

export interface PlacedChange {
  path: string
  kind: ChangeKind
  // The file on the map, for a change to a file it shows.
  nodeId?: string
  // The node the change lives in: the file itself, or the folder that holds
  // the placeholder. Undefined when its repository is not on the map.
  holderId?: string
  // The placeholder's square, for an added file.
  placeholder?: Rect
}

// A dashed box for a folder a colonist adds, labelled `<name>/ new`.
export interface NewFolder {
  name: string
  holderId: string
  rect: Rect
  // The height of its label strip, in grid units.
  header: number
}

export interface PlacedColonist {
  colonist: Colonist
  changes: PlacedChange[]
  folders: NewFolder[]
  // Everything it touches on the map, to frame it; undefined when nothing is.
  bounds?: Rect
}

// Units of padding inside a container's left, right and bottom edges, as the
// layout leaves them.
const PAD = 1
// Placeholders shrink by halves down to this side before giving up a spot.
const MIN_UNITS = 0.25
// A new folder box: a square per file of this side, with gaps of half of it.
const FOLDER_FILE_UNITS = 1
const FOLDER_HEADER_UNITS = 1

export function placeColonists(scene: Scene, colonists: readonly Colonist[]): PlacedColonist[] {
  // Placeholders taken so far in each holder, so colonists never overlap.
  const taken = new Map<string, Rect[]>()
  return colonists.map((colonist) => placeColonist(scene, colonist, taken))
}

function placeColonist(
  scene: Scene,
  colonist: Colonist,
  taken: Map<string, Rect[]>,
): PlacedColonist {
  const placed: PlacedColonist = { colonist, changes: [], folders: [] }
  const repo = scene.byId.get(colonist.repoId)
  if (!repo) {
    placed.changes = colonist.changes.map(({ path, kind }) => ({ path, kind }))
    return placed
  }
  // Added files not on the map, by holder and the new folder they start.
  const groups = new Map<string, { holder: WorldNode; folder?: string; changes: PlacedChange[] }>()
  const pending: { change: PlacedChange; units: number }[] = []
  for (const { path, kind, units } of colonist.changes) {
    const change: PlacedChange = { path, kind }
    placed.changes.push(change)
    const file = scene.byId.get(`${repo.id}/${path}`)
    if (file?.kind === 'file') {
      change.nodeId = file.id
      change.holderId = file.id
      continue
    }
    if (kind !== 'added') continue
    const { holder, folder } = findHolder(scene, repo, path)
    change.holderId = holder.id
    const key = `${holder.id}\0${folder ?? ''}`
    let group = groups.get(key)
    if (!group) {
      group = { holder, changes: [], ...(folder ? { folder } : {}) }
      groups.set(key, group)
    }
    group.changes.push(change)
    if (!folder) pending.push({ change, units })
  }

  // Larger placeholders first, so the small ones fill the gaps they leave.
  pending.sort((a, b) => b.units - a.units || a.change.path.localeCompare(b.change.path))
  for (const { change, units } of pending) {
    const holder = scene.byId.get(change.holderId as string) as WorldNode
    const rect = findFreeSpot(scene, holder, units, units, taken)
    if (rect) change.placeholder = rect
  }
  for (const group of groups.values()) {
    if (!group.folder) continue
    const box = placeFolder(scene, group.holder, group.changes, taken)
    if (box) placed.folders.push({ name: group.folder, holderId: group.holder.id, ...box })
  }

  const rects = [
    ...placed.changes.flatMap((change) => {
      if (change.placeholder) return [change.placeholder]
      const node = change.nodeId ? scene.byId.get(change.nodeId) : undefined
      return node ? [node.rect] : []
    }),
    ...placed.folders.map((folder) => folder.rect),
  ]
  const bounds = unionOf(rects)
  if (bounds) placed.bounds = bounds
  return placed
}

// The deepest folder on the map that holds the path, and the first folder
// of the path below it that is not on the map yet.
function findHolder(
  scene: Scene,
  repo: WorldNode,
  path: string,
): { holder: WorldNode; folder?: string } {
  const parts = path.split('/').slice(0, -1)
  for (let depth = parts.length; depth > 0; depth--) {
    const dir = parts.slice(0, depth).join('/')
    const holder = [`${repo.id}/package:${dir}`, `${repo.id}/${dir}`]
      .map((id) => scene.byId.get(id))
      .find((node) => node?.kind === 'package' || node?.kind === 'module')
    const folder = parts[depth]
    if (holder) return folder ? { holder, folder } : { holder }
  }
  const folder = parts[0]
  return folder ? { holder: repo, folder } : { holder: repo }
}

// Lays a new folder's files out as small squares in a box, and finds the box
// a spot, shrinking it as a whole when it does not fit.
function placeFolder(
  scene: Scene,
  holder: WorldNode,
  changes: readonly PlacedChange[],
  taken: Map<string, Rect[]>,
): { rect: Rect; header: number } | undefined {
  const columns = Math.ceil(Math.sqrt(changes.length))
  const rows = Math.ceil(changes.length / columns)
  const step = FOLDER_FILE_UNITS * 1.5
  const w = FOLDER_FILE_UNITS * 0.5 + columns * step
  const h = FOLDER_HEADER_UNITS + FOLDER_FILE_UNITS * 0.5 + rows * step - FOLDER_FILE_UNITS * 0.5
  const box = findFreeSpot(scene, holder, w, h, taken)
  if (!box) return undefined
  const scale = box.w / w
  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path))
  sorted.forEach((change, i) => {
    const column = i % columns
    const row = Math.floor(i / columns)
    change.placeholder = {
      x: box.x + (FOLDER_FILE_UNITS * 0.5 + column * step) * scale,
      y: box.y + (FOLDER_HEADER_UNITS + row * step) * scale,
      w: FOLDER_FILE_UNITS * scale,
      h: FOLDER_FILE_UNITS * scale,
    }
  })
  return { rect: box, header: FOLDER_HEADER_UNITS * scale }
}

// The first free spot, top to bottom then left to right, for a w by h block
// inside the holder's content area, halving the block until it fits. Spots
// are tried where the free area starts: at the content's edges and along the
// right and bottom edges of what is already there.
function findFreeSpot(
  scene: Scene,
  holder: WorldNode,
  w: number,
  h: number,
  taken: Map<string, Rect[]>,
): Rect | undefined {
  const { rect } = holder
  const left = rect.x + PAD
  const top = rect.y + HEADER_UNITS[holder.kind]
  const right = rect.x + rect.w - PAD
  const bottom = rect.y + rect.h - PAD
  const used = taken.get(holder.id) ?? []
  const blocks = [
    ...(scene.children.get(holder.id) ?? [])
      .filter((child) => child.kind !== 'symbol')
      .map((child) => child.rect),
    ...used,
  ]
  const xs = [...new Set([left, ...blocks.map((b) => b.x + b.w)])].sort((a, b) => a - b)
  const ys = [...new Set([top, ...blocks.map((b) => b.y + b.h)])].sort((a, b) => a - b)
  for (let scale = 1; Math.min(w, h) * scale >= MIN_UNITS; scale /= 2) {
    const sw = w * scale
    const sh = h * scale
    for (const y of ys) {
      if (y < top || y + sh > bottom) continue
      for (const x of xs) {
        if (x < left || x + sw > right) continue
        const spot = { x, y, w: sw, h: sh }
        if (blocks.some((block) => overlaps(block, spot))) continue
        used.push(spot)
        taken.set(holder.id, used)
        return spot
      }
    }
  }
  return undefined
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function unionOf(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
