import type { RouteNode } from '../../lane-routing/route-boxes.ts'
import { logError } from '../../logging/log.ts'
import {
  type Highways,
  type HolderRoutes,
  type LaneEdge,
  type LaneRoutes,
  LaneWorld,
} from './lane-world.ts'

// Talks to the routing worker (lane-worker.ts). Where workers are missing, as
// under test, it routes on the calling thread instead.

export type LaneRequest =
  | { op: 'world'; version: number; nodes: RouteNode[]; edges: LaneEdge[] }
  | { op: 'highways'; id: number; version: number }
  | { op: 'holder'; id: number; version: number; holder: string }

export interface LaneReply {
  id: number
  highways?: Highways
  holder?: HolderRoutes
  error?: string
}

export interface LaneRouterHandle {
  // Replaces the world routed; requests for older versions fail.
  loadWorld(version: number, nodes: RouteNode[], edges: LaneEdge[]): void
  routeHighways(version: number): Promise<Highways>
  routeHolder(version: number, holder: string): Promise<HolderRoutes>
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
  if (request.op === 'highways') return { id: request.id, highways: world.lanes.routeHighways() }
  return { id: request.id, holder: world.lanes.routeHolder(request.holder) }
}

// A reply ready to post with its buffers moved, not copied. A holder's routes
// are built for the reply and can move; the highways stay with the world,
// which routes holders against them, so a copy of them moves instead.
export function toTransfer(reply: LaneReply): { reply: LaneReply; transfer: ArrayBuffer[] } {
  const transfer: ArrayBuffer[] = []
  let sent = reply
  const move = (routes: LaneRoutes) => {
    transfer.push(
      routes.points.buffer as ArrayBuffer,
      routes.offsets.buffer as ArrayBuffer,
      routes.links.buffer as ArrayBuffer,
    )
    if (routes.arrows) transfer.push(routes.arrows.buffer as ArrayBuffer)
  }
  if (reply.holder) {
    move(reply.holder.routes)
    transfer.push(
      reply.holder.edgeOffsets.buffer as ArrayBuffer,
      reply.holder.edges.buffer as ArrayBuffer,
    )
  }
  if (reply.highways) {
    const { routes, linkOfEdge } = reply.highways
    const copy: LaneRoutes = {
      links: routes.links.slice(),
      points: routes.points.slice(),
      offsets: routes.offsets.slice(),
      pitch: routes.pitch,
    }
    const edges = linkOfEdge.slice()
    sent = { ...reply, highways: { ...reply.highways, routes: copy, linkOfEdge: edges } }
    move(copy)
    transfer.push(edges.buffer)
  }
  return { reply: sent, transfer }
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
    async routeHighways(version) {
      const reply = await ask({ op: 'highways', id: next++, version })
      if (!reply.highways) throw new Error(reply.error ?? 'no highways')
      return reply.highways
    },
    async routeHolder(version, holder) {
      const reply = await ask({ op: 'holder', id: next++, version, holder })
      if (!reply.holder) throw new Error(reply.error ?? 'no holder routes')
      return reply.holder
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
    async routeHighways(version) {
      return (await ask({ op: 'highways', id: next++, version })).highways as Highways
    },
    async routeHolder(version, holder) {
      return (await ask({ op: 'holder', id: next++, version, holder })).holder as HolderRoutes
    },
    dispose() {
      world = undefined
    },
  }
}
