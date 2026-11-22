import { HEADER_UNITS, type Rect, type WorldNode } from '../world/world-types.ts'
import type { RouteBox } from './channel-graph.ts'

// The boxes dependency lanes route between, from the world tree. A block is
// a closed container, a container that holds only files (a module), or the
// files directly in a container that also holds folders, taken together.
// Lanes never enter a block; they end on its sides. Once its files are open,
// a module, or a container's own files, holds each file as a block of its
// own, and lanes run in the streets between them.

// The fields of a world node that routing reads.
export type RouteNode = Pick<WorldNode, 'id' | 'parent' | 'kind' | 'rect'>

export interface RouteBoxes {
  root: RouteBox | undefined
  // The block that holds a node (container, file or symbol), if any.
  blockOf(id: string): string | undefined
  // Whether any file is a block of its own.
  hasFileBlocks: boolean
}

// The row item that holds a container's own files. "#" only ever follows a
// file id elsewhere, so it cannot clash with a node id.
export function looseId(container: string): string {
  return `${container}#files`
}

// isOpen: whether a container shows its children; closed containers are
// blocks. isFileOpen: whether a container of only files (by its id), or a
// container's own files beside its folders (by looseId), holds each file as a
// block.
export function buildRouteBoxes(
  nodes: readonly RouteNode[],
  isOpen: (id: string) => boolean = () => true,
  isFileOpen: (holder: string) => boolean = () => false,
): RouteBoxes {
  const children = new Map<string, RouteNode[]>()
  let world: RouteNode | undefined
  for (const node of nodes) {
    if (node.kind === 'world') world = node
    if (!node.parent || node.kind === 'symbol') continue
    const list = children.get(node.parent)
    if (list) list.push(node)
    else children.set(node.parent, [node])
  }
  // Container id -> the block its files belong to.
  const fileBlock = new Map<string, string>()
  // Containers whose files are blocks of their own.
  const openFiles = new Set<string>()
  const fileBoxes = (files: readonly RouteNode[]): RouteBox[] =>
    files.map((file) => ({ id: file.id, rect: file.rect }))

  const build = (node: RouteNode, closedBy: string | undefined): RouteBox | undefined => {
    const kids = children.get(node.id) ?? []
    const folders = kids.filter((kid) => kid.kind !== 'file')
    const files = kids.filter((kid) => kid.kind === 'file')
    if (closedBy !== undefined) {
      fileBlock.set(node.id, closedBy)
      for (const folder of folders) build(folder, closedBy)
      return undefined
    }
    if (node.kind !== 'world' && folders.length === 0 && files.length > 0 && isFileOpen(node.id)) {
      openFiles.add(node.id)
      return {
        id: node.id,
        rect: node.rect,
        header: HEADER_UNITS[node.kind],
        kids: fileBoxes(files),
      }
    }
    if (node.kind !== 'world' && (folders.length === 0 || !isOpen(node.id))) {
      fileBlock.set(node.id, node.id)
      for (const folder of folders) build(folder, node.id)
      return { id: node.id, rect: node.rect }
    }
    const boxes: RouteBox[] = []
    for (const folder of folders) {
      const box = build(folder, undefined)
      if (box) boxes.push(box)
    }
    if (files.length > 0) {
      const id = looseId(node.id)
      if (isFileOpen(id)) {
        openFiles.add(node.id)
        boxes.push({ id, rect: boundsOf(files), header: 0, kids: fileBoxes(files) })
      } else {
        fileBlock.set(node.id, id)
        boxes.push({ id, rect: boundsOf(files) })
      }
    }
    return { id: node.id, rect: node.rect, header: HEADER_UNITS[node.kind], kids: boxes }
  }

  const root = world ? build(world, undefined) : undefined
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return {
    root,
    blockOf(id) {
      const hash = id.indexOf('#')
      const node = byId.get(hash < 0 ? id : id.slice(0, hash))
      if (!node) return undefined
      if (node.kind !== 'file') return fileBlock.get(node.id)
      const holder = node.parent ?? ''
      return openFiles.has(holder) ? node.id : fileBlock.get(holder)
    },
    hasFileBlocks: openFiles.size > 0,
  }
}

function boundsOf(nodes: readonly RouteNode[]): Rect {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const { rect } of nodes) {
    x0 = Math.min(x0, rect.x)
    y0 = Math.min(y0, rect.y)
    x1 = Math.max(x1, rect.x + rect.w)
    y1 = Math.max(y1, rect.y + rect.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
