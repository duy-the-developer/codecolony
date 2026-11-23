import type { RouteNode } from '../../lane-routing/route-boxes.ts'
import { logError } from '../../logging/log.ts'
import { type FileLines, type LaneEdge, LaneWorld } from './lane-world.ts'

// Talks to the routing worker (lane-worker.ts). Where workers are missing, as
// under test, it routes on the calling thread instead.

export type LaneRequest =
  | { op: 'world'; version: number; nodes: RouteNode[]; edges: LaneEdge[] }
  | { op: 'files'; id: number; version: number }

export interface LaneReply {
  id: number
  files?: FileLines
  error?: string
}

export interface LaneRouterHandle {
  // Replaces the world routed; requests for older versions fail.
  loadWorld(version: number, nodes: RouteNode[], edges: LaneEdge[]): void
  routeFiles(version: number): Promise<FileLines>
  dispose(): void
}

export function createLaneRouter(): LaneRouterHandle {
  return typeof Worker === 'undefined' ? createLocalRouter() : createWorkerRouter()
}

// Answers one request against the current world. Shared by the worker and
// the local router.
export function answerLaneRequest(
  world: { version: number; lanes: LaneWorld } | undefined,
  request: Exclude<LaneRequest, { op: 'world' }>,
): LaneReply {
  if (!world || world.version !== request.version) return { id: request.id, error: 'stale' }
  return { id: request.id, files: world.lanes.routeFiles() }
}

// A reply ready to post with its buffers moved, not copied. The world keeps
// its lines, so a copy of them moves instead.
export function toTransfer(reply: LaneReply): { reply: LaneReply; transfer: ArrayBuffer[] } {
  if (!reply.files) return { reply, transfer: [] }
  const { routes, edgeOffsets, edges } = reply.files
  const files: FileLines = {
    links: reply.files.links,
    routes: {
      links: routes.links.slice(),
      points: routes.points.slice(),
      offsets: routes.offsets.slice(),
      pitch: routes.pitch,
    },
    edgeOffsets: edgeOffsets.slice(),
    edges: edges.slice(),
  }
  const transfer = [
    files.routes.links.buffer,
    files.routes.points.buffer,
    files.routes.offsets.buffer,
    files.edgeOffsets.buffer,
    files.edges.buffer,
  ] as ArrayBuffer[]
  return { reply: { ...reply, files }, transfer }
}

function createWorkerRouter(): LaneRouterHandle {
  const worker = new Worker(new URL('./lane-worker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, (reply: LaneReply) => void>()
  let next = 0
  worker.onmessage = (event: MessageEvent<LaneReply>) => {
    const resolve = waiting.get(event.data.id)
    waiting.delete(event.data.id)
    resolve?.(event.data)
  }
  // A crashed worker answers nothing more: fail what is waiting, so callers
  // stop waiting for it.
  worker.onerror = (event: ErrorEvent) => {
    logError('Lane worker failed', { message: event.message })
    for (const [id, resolve] of waiting) resolve({ id, error: 'worker failed' })
    waiting.clear()
  }
  const ask = (request: Exclude<LaneRequest, { op: 'world' }>) =>
    new Promise<LaneReply>((resolve) => {
      waiting.set(request.id, resolve)
      worker.postMessage(request)
    })
  return {
    loadWorld(version, nodes, edges) {
      worker.postMessage({ op: 'world', version, nodes, edges } satisfies LaneRequest)
    },
    async routeFiles(version) {
      const reply = await ask({ op: 'files', id: next++, version })
      if (!reply.files) throw new Error(reply.error ?? 'no lines')
      return reply.files
    },
    dispose() {
      worker.terminate()
      waiting.clear()
    },
  }
}

function createLocalRouter(): LaneRouterHandle {
  let world: { version: number; lanes: LaneWorld } | undefined
  let next = 0
  const ask = (request: Exclude<LaneRequest, { op: 'world' }>) => {
    const reply = answerLaneRequest(world, request)
    return reply.error ? Promise.reject(new Error(reply.error)) : Promise.resolve(reply)
  }
  return {
    loadWorld(version, nodes, edges) {
      world = { version, lanes: new LaneWorld(nodes, edges) }
    },
    async routeFiles(version) {
      return (await ask({ op: 'files', id: next++, version })).files as FileLines
    },
    dispose() {
      world = undefined
    },
  }
}
