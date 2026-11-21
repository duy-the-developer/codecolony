import { answerLaneRequest, type LaneReply, type LaneRequest } from './lane-router.ts'
import { LaneWorld } from './lane-world.ts'

// The routing worker: holds one world version and answers level and route
// requests for it in order (see lane-router.ts).

let world: { version: number; lanes: LaneWorld } | undefined

self.onmessage = (event: MessageEvent<LaneRequest>) => {
  const request = event.data
  if (request.op === 'world') {
    world = { version: request.version, lanes: new LaneWorld(request.nodes, request.edges) }
    return
  }
  let reply: LaneReply
  try {
    reply = answerLaneRequest(world, request)
  } catch (error) {
    reply = { id: request.id, error: error instanceof Error ? error.message : String(error) }
  }
  const transfer: ArrayBuffer[] = []
  if (reply.routes) {
    transfer.push(
      reply.routes.points.buffer as ArrayBuffer,
      reply.routes.offsets.buffer as ArrayBuffer,
      reply.routes.links.buffer as ArrayBuffer,
    )
  }
  if (reply.level) transfer.push(reply.level.linkOfEdge.buffer as ArrayBuffer)
  self.postMessage(reply, { transfer })
}
