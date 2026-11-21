import { logError } from '../shared/log.ts'
import type { RouteNode } from '../shared/route-boxes.ts'
import { type LaneEdge, type LaneLevel, type LaneRoutes, LaneWorld } from './lane-world.ts'

// Talks to the routing worker (lane-worker.ts). Where workers are missing, as
// under test, it routes on the calling thread instead.

export type LaneRequest =
  | { op: 'world'; version: number; nodes: RouteNode[]; edges: LaneEdge[] }
  | { op: 'level'; id: number; version: number; key: string; open: readonly string[] }
  | {
      op: 'route'
      id: number
      version: number
      key: string
      open: readonly string[]
      only?: readonly number[]
    }

export interface LaneReply {
  id: number
  level?: LaneLevel
  routes?: LaneRoutes
  error?: string
}

export interface LaneRouterHandle {
  // Replaces the world routed; requests for older versions fail.
  loadWorld(version: number, nodes: RouteNode[], edges: LaneEdge[]): void
  describeLevel(version: number, key: string, open: readonly string[]): Promise<LaneLevel>
  route(
    version: number,
    key: string,
    open: readonly string[],
    only?: readonly number[],
  ): Promise<LaneRoutes>
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
  if (request.op === 'level') {
    return { id: request.id, level: world.lanes.describeLevel(request.key, request.open) }
  }
  return {
    id: request.id,
    routes: world.lanes.route(request.key, request.open, request.only),
  }
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
    async describeLevel(version, key, open) {
      const reply = await ask({ op: 'level', id: next++, version, key, open: [...open] })
      if (!reply.level) throw new Error(reply.error ?? 'no level')
      return reply.level
    },
    async route(version, key, open, only) {
      const request: LaneRequest = { op: 'route', id: next++, version, key, open: [...open] }
      if (only) request.only = [...only]
      const reply = await ask(request)
      if (!reply.routes) throw new Error(reply.error ?? 'no routes')
      return reply.routes
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
    async describeLevel(version, key, open) {
      return (await ask({ op: 'level', id: next++, version, key, open })).level as LaneLevel
    },
    async route(version, key, open, only) {
      const request: LaneRequest = { op: 'route', id: next++, version, key, open }
      if (only) request.only = only
      return (await ask(request)).routes as LaneRoutes
    },
    dispose() {
      world = undefined
    },
  }
}
