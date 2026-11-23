import type { Attachment, ChannelGraph } from './channel-graph.ts'
import type { Link } from './route-lanes.ts'
import { CostHeap, findPaths, resolveSearchGraph } from './search-graph.ts'

// Plans every line's path as a chain of shared stretches, as a circuit
// board's router plans the course between blocks first and the wiring inside
// each block after (global and detailed routing).
//
// Every open folder has an entry point on each side: one door on its left,
// right and bottom, and one down through its label strip right of the label
// when there is room (channel-graph.ts). A line from file a to file b runs:
// - inside each folder that holds a but not b, from the box holding a (a
//   itself, or the entry point of the subfolder holding it) to the entry
//   point it leaves by;
// - in the deepest folder that holds both, along the highway from the entry
//   point (or file) of the box holding a to the entry point (or file) of the
//   box holding b;
// - inside each folder that holds b but not a, from the entry point it came
//   in by to the box holding b.
// Each stretch is the shortest path inside its own folder, never touching
// another folder or a file on the way, and is found once: every line with
// the same two ends in the same folder takes it, and shares one lane along
// it. Stretches run one way, so lines into a folder and lines out of it never
// share a lane. Which entry point a highway uses follows where its other end
// is. Everything is worked out from the layout alone.

export interface PathPlan {
  // Per link: the attachments it crosses, from a side of its importer to a
  // side of the file it imports, as findPaths gives them; undefined when no
  // path exists.
  paths: (number[] | undefined)[]
  // Per link: the stretch each step runs in, the channel between path[step]
  // and path[step + 1].
  stretches: (Int32Array | undefined)[]
  // Per stretch: the end it runs to, so that stretches with one end can
  // share a lane when a channel is full.
  stretchEnds: Int32Array
}

// A folder: an open box with a label strip, or the root.
interface Folder {
  parent: number
  // Its entry points, by side, as door attachments: their bar lies outside.
  doors: number[]
}

interface Plan {
  attachments: number[]
  // The door the stretch starts or ends at, if its end is a folder.
  startDoor: number
  endDoor: number
  // Per step, the stretch whose lane it takes.
  tags: number[]
}

// What a stretch runs to, for sharing lanes when a channel is full: a file,
// a subfolder (into it), a folder's door (out of it), or a door's shared lane
// in or out.
const FILE = 0
const INTO = 1
const OUT_OF = 2
const DOOR_IN = 3
const DOOR_OUT = 4

export function planHighways(graph: ChannelGraph, links: readonly Link[]): PathPlan {
  const { attachments, channels, nest } = graph
  const search = resolveSearchGraph(graph)
  const { offsets, targets, costs, nodeX, nodeY } = search
  const nodes = offsets.length - 1

  // Folders, and the folder each box belongs to directly.
  const folders: Folder[] = []
  const folderOf = new Map<string, number>()
  const order = [...nest.entries()].sort((a, b) => a[1].order - b[1].order)
  for (const [id, entry] of order) {
    const own = entry.parent === undefined ? -1 : (folderOf.get(entry.parent) ?? -1)
    if (entry.isScope) {
      folderOf.set(id, folders.length)
      folders.push({ parent: own, doors: [] })
    } else {
      folderOf.set(id, own)
    }
  }
  // The folder each box sits in: for a folder, the one around it.
  const sitsIn = (id: string): number => {
    const parent = nest.get(id)?.parent
    return parent === undefined ? -1 : (folderOf.get(parent) ?? -1)
  }

  // Per node, the folder its channel lies in; -1 for a block side.
  const region = new Int32Array(nodes).fill(-1)
  const channelFolder = channels.map((channel) => folderOf.get(channel.container) ?? -1)
  attachments.forEach((a, i) => {
    region[2 * i] = channelFolder[a.bar] as number
    if (a.channel !== undefined) region[2 * i + 1] = channelFolder[a.channel] as number
  })

  // Entry points: a door is an attachment whose stem is a channel inside a
  // folder and whose bar lies outside it. One per side, the one with the
  // most lanes, nearest the middle of the side.
  {
    const bySide = new Map<string, number[]>()
    attachments.forEach((a, i) => {
      if (a.channel === undefined) return
      const inside = channelFolder[a.channel] as number
      const outside = channelFolder[a.bar] as number
      if (inside < 0 || inside === outside || (folders[inside] as Folder).parent !== outside) return
      const key = `${inside}\n${sideOf(graph, a)}`
      const list = bySide.get(key)
      if (list) list.push(i)
      else bySide.set(key, [i])
    })
    for (const [key, list] of bySide) {
      const folder = Number(key.slice(0, key.indexOf('\n')))
      const room = (i: number) => roomOf(graph, i)
      const most = Math.max(...list.map(room))
      const best = list
        .filter((i) => room(i) === most)
        .sort(
          (i, j) =>
            along(attachments[i] as Attachment) - along(attachments[j] as Attachment) || i - j,
        )
      ;(folders[folder] as Folder).doors.push(best[(best.length - 1) >> 1] as number)
    }
    for (const folder of folders) folder.doors.sort((a, b) => a - b)
  }

  // One search at a time, inside one folder, from any start node to any end
  // node, guided by the distance left to the box around the ends.
  const dist = new Float64Array(nodes)
  const prev = new Int32Array(nodes)
  const seen = new Int32Array(nodes)
  const isEnd = new Int32Array(nodes)
  const heap = new CostHeap()
  let round = 0
  const find = (
    folder: number,
    starts: readonly number[],
    ends: readonly number[],
  ): { path: number[]; start: number; end: number } | undefined => {
    if (starts.length === 0 || ends.length === 0) return undefined
    round++
    let x0 = Number.POSITIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (const node of ends) {
      isEnd[node] = round
      x0 = Math.min(x0, nodeX[node] as number)
      y0 = Math.min(y0, nodeY[node] as number)
      x1 = Math.max(x1, nodeX[node] as number)
      y1 = Math.max(y1, nodeY[node] as number)
    }
    const left = (node: number) => {
      const x = nodeX[node] as number
      const y = nodeY[node] as number
      return Math.max(x0 - x, 0, x - x1) + Math.max(y0 - y, 0, y - y1)
    }
    heap.clear()
    for (const node of starts) {
      seen[node] = round
      dist[node] = 0
      prev[node] = -1
      heap.push(node, left(node))
    }
    for (;;) {
      const node = heap.pop()
      if (node < 0) return undefined
      if (heap.cost > (dist[node] as number) + left(node)) continue
      if (isEnd[node] === round && prev[node] !== -1) {
        const path: number[] = []
        let n = node
        for (; prev[n] !== -1; n = prev[n] as number) {
          if ((prev[n] as number) >> 1 === n >> 1) path.push(n >> 1)
        }
        return { path: path.reverse(), start: n, end: node }
      }
      const base = dist[node] as number
      for (let e = offsets[node] as number; e < (offsets[node + 1] as number); e++) {
        const next = targets[e] as number
        // Only this folder's own channels, and the ends.
        if (region[next] !== folder && isEnd[next] !== round) continue
        const cost = base + (costs[e] as number)
        if (seen[next] === round && cost >= (dist[next] as number)) continue
        seen[next] = round
        dist[next] = cost
        prev[next] = node
        heap.push(next, cost + left(next))
      }
    }
  }

  // A box's nodes as an end of a stretch in the folder around it: a file's
  // sides, or a subfolder's doors from outside (the door's bar).
  const blockNodes = (block: string): number[] =>
    (graph.blockAttachments.get(block) ?? []).map((a) => 2 * a + 1)
  const doorsOut = (folder: number) => (folders[folder] as Folder).doors.map((d) => 2 * d)

  // Stretches, found once each, by their folder and ends.
  const plans = new Map<string, Plan | null>()
  const stretchEnds: number[] = []
  const endIds = new Map<string, number>()
  const endId = (kind: number, id: string | number) => {
    const key = `${kind}\n${id}`
    let found = endIds.get(key)
    if (found === undefined) {
      found = endIds.size
      endIds.set(key, found)
    }
    return found
  }
  const plan = (
    key: string,
    folder: number,
    starts: number[],
    ends: number[],
    end: number,
  ): Plan | undefined => {
    const known = plans.get(key)
    if (known !== undefined) return known ?? undefined
    const found = find(folder, starts, ends)
    if (!found) {
      plans.set(key, null)
      return undefined
    }
    // A door at either end is crossed too.
    const attachments = [...found.path]
    const startDoor = found.start % 2 === 0 || isDoorStem(found.start) ? found.start >> 1 : -1
    const endDoor = found.end % 2 === 0 || isDoorStem(found.end) ? found.end >> 1 : -1
    if (startDoor >= 0) attachments.unshift(startDoor)
    if (endDoor >= 0) attachments.push(endDoor)
    const stretch = stretchEnds.push(end) - 1
    const tags = attachments.slice(1).map(() => stretch)
    // Every line through a door shares one lane in the channels on either
    // side of it, one lane for lines in and one for lines out, so a folder's
    // entry point is one spot on its border and lines fork only past it.
    // Out of a folder: from a subfolder's door, and to this folder's door on
    // the way out (key 'o'), or along a highway; into a folder: to a
    // subfolder's door (key 'i'), or along a highway to its far end.
    const isInbound = key[0] === 'i'
    if (startDoor >= 0 && tags.length > 0) tags[0] = doorLane(startDoor, isInbound)
    if (endDoor >= 0 && tags.length > 0) tags[tags.length - 1] = doorLane(endDoor, key[0] !== 'o')
    const made: Plan = { attachments, startDoor, endDoor, tags }
    plans.set(key, made)
    return made
  }
  // The shared lane of the lines into (or out of) a folder through a door.
  const doorLanes = new Map<string, number>()
  const doorLane = (door: number, isInbound: boolean): number => {
    const key = `${isInbound ? 'in' : 'out'}\n${door}`
    let lane = doorLanes.get(key)
    if (lane === undefined) {
      lane = stretchEnds.push(endId(isInbound ? DOOR_IN : DOOR_OUT, door)) - 1
      doorLanes.set(key, lane)
    }
    return lane
  }
  // A stem node at a door inside its folder (not a block side).
  const isDoorStem = (node: number) => (attachments[node >> 1] as Attachment).block === undefined

  // The box a file sits in, one level below `folder`: its subfolder, or the
  // file itself (-1).
  const chainOf = (file: string): number[] => {
    const chain: number[] = []
    for (let f = sitsIn(file); f >= 0; f = (folders[f] as Folder).parent) chain.push(f)
    return chain
  }

  const paths: (number[] | undefined)[] = []
  const stretches: (Int32Array | undefined)[] = []
  const unplanned: number[] = []
  links.forEach((link, i) => {
    const found = planLink(link)
    if (!found) {
      unplanned.push(i)
      paths.push(undefined)
      stretches.push(undefined)
      return
    }
    paths.push(found.path)
    stretches.push(found.stretches)
  })

  function planLink(link: Link): { path: number[]; stretches: Int32Array } | undefined {
    if (link.from === link.to) return undefined
    const up = chainOf(link.from)
    const down = chainOf(link.to)
    if (up.length === 0 || down.length === 0) return undefined
    // The deepest folder holding both, and the folders below it on each side.
    const downSet = new Set(down)
    const shared = up.findIndex((f) => downSet.has(f))
    if (shared < 0) return undefined
    const scope = up[shared] as number
    const outs = up.slice(0, shared)
    const ins = down.slice(0, down.indexOf(scope)).reverse()
    const pieces: Plan[] = []

    // The highway, between the boxes holding each end in the shared folder.
    const fromBox = outs[outs.length - 1]
    const toBox = ins[0]
    const highway = plan(
      `h\n${scope}\n${fromBox ?? link.from}\n${toBox ?? link.to}`,
      scope,
      fromBox === undefined ? blockNodes(link.from) : doorsOut(fromBox),
      toBox === undefined ? blockNodes(link.to) : doorsOut(toBox),
      toBox === undefined ? endId(FILE, link.to) : endId(INTO, toBox),
    )
    if (!highway) return undefined

    // Out of each folder holding the importer, innermost last.
    const before: Plan[] = []
    let door = highway.startDoor
    for (let k = outs.length - 1; k >= 0; k--) {
      const folder = outs[k] as number
      const inner = k > 0 ? (outs[k - 1] as number) : undefined
      const piece = plan(
        `o\n${folder}\n${inner ?? link.from}\n${door}`,
        folder,
        inner === undefined ? blockNodes(link.from) : doorsOut(inner),
        [2 * door + 1],
        endId(OUT_OF, door),
      )
      if (!piece) return undefined
      before.push(piece)
      door = piece.startDoor
    }
    // Into each folder holding the imported file, outermost first.
    const after: Plan[] = []
    door = highway.endDoor
    for (let k = 0; k < ins.length; k++) {
      const folder = ins[k] as number
      const inner = k + 1 < ins.length ? (ins[k + 1] as number) : undefined
      const piece = plan(
        `i\n${folder}\n${door}\n${inner ?? link.to}`,
        folder,
        [2 * door + 1],
        inner === undefined ? blockNodes(link.to) : doorsOut(inner),
        inner === undefined ? endId(FILE, link.to) : endId(INTO, inner),
      )
      if (!piece) return undefined
      after.push(piece)
      door = piece.endDoor
    }
    pieces.push(...before.reverse(), highway, ...after)

    // Joined at their doors: each piece starts on the door the one before
    // it ends on.
    const path: number[] = []
    const tags: number[] = []
    for (const piece of pieces) {
      path.push(...(path.length === 0 ? piece.attachments : piece.attachments.slice(1)))
      tags.push(...piece.tags)
    }
    return { path, stretches: Int32Array.from(tags) }
  }

  // Lines the folders cannot plan (a folder with no way in) fall back to a
  // path of their own, a stretch of their own.
  if (unplanned.length > 0) {
    const own = findPaths(
      graph,
      search,
      unplanned.map((i) => links[i] as Link),
    )
    unplanned.forEach((i, k) => {
      const path = own[k]
      if (!path) return
      const stretch = stretchEnds.push(endId(FILE, (links[i] as Link).to)) - 1
      paths[i] = path
      stretches[i] = new Int32Array(Math.max(0, path.length - 1)).fill(stretch)
    })
  }
  return { paths, stretches, stretchEnds: Int32Array.from(stretchEnds) }
}

// Which side of its folder a door leads out of, from where its bar lies.
function sideOf(graph: ChannelGraph, a: Attachment): string {
  const bar = graph.channels[a.bar]
  if (!bar) return ''
  if (bar.axis === 'y') return bar.high <= a.mouth ? 'left' : 'right'
  return bar.high <= a.mouth ? 'top' : 'bottom'
}

// How many lanes the channel inside a door holds.
function roomOf(graph: ChannelGraph, door: number): number {
  const a = graph.attachments[door] as Attachment
  const stem = a.channel === undefined ? undefined : graph.channels[a.channel]
  return stem ? Math.max(0, Math.ceil(stem.high) - Math.floor(stem.low) - 1) : 0
}

function along(a: Attachment): number {
  return (a.from + a.to) / 2
}
