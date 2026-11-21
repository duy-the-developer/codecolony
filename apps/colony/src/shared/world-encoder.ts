import { EDGE_KINDS, type Edge, PROVENANCES, SYMBOL_KINDS } from '../core/model.ts'
import { diffSequences, type SequenceEdit } from './sequence-diff.ts'
import {
  AT_FROM,
  EDGE_STRIDE,
  NODE_KINDS,
  type NodeExtra,
  type NodeRow,
  RECT_QUANTUM,
  type Splice,
  type SymbolRow,
  type SymbolsResponse,
  type World,
  type WorldNode,
  type WorldPatch,
  type WorldPayload,
} from './world-types.ts'

// Turns the server's World into the compact wire format (see the wire types in
// world-types.ts) and remembers the version before, so a page that holds it
// gets a patch instead of the whole world. Bodies are encoded once per version
// and shared by every page.

export interface WorldEncoderOptions {
  session?: string
  // A patch bigger than this many inserted and deleted rows is sent whole.
  maxEdits?: number
}

export interface WorldEncoderHandle {
  readonly session: string
  // The JSON body of GET /api/world: a patch when the page holds `since`
  // (the version before this one) in this session, else the whole world.
  encodeWorld(world: World, since?: { session: string; version: number }): string
  // The symbols of files by node index, or undefined when `held` is not the
  // world's version in this session.
  encodeSymbols(
    world: World,
    held: { session: string; version: number },
    files: readonly number[],
  ): SymbolsResponse | undefined
}

export class WorldEncodeError extends Error {
  override name = 'WorldEncodeError'
  readonly code: 'ParentAfterChild'
  constructor(message: string, code: 'ParentAfterChild', options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

// What the next version needs to patch from this one. The version before
// keeps only this, so its World can be freed.
interface PatchBase {
  version: number
  stringCount: number
  nodeKeys: string[]
  edgeKeys: string[]
}

interface EncodedVersion extends PatchBase {
  world: World
  rows: NodeRow[]
  edges: number[]
  // Node index -> its symbols, in world order.
  symbols: Map<number, SymbolRow[]>
  full?: string
  // The patch from the version before; null when too big to be worth it.
  patch?: string | null
}

const DEFAULT_MAX_EDITS = 50_000
const MISSING = '\u0000'

export function createWorldEncoder(options: WorldEncoderOptions = {}): WorldEncoderHandle {
  const session = options.session ?? crypto.randomUUID()
  const maxEdits = options.maxEdits ?? DEFAULT_MAX_EDITS
  // Append-only for the life of the session, so a patch only adds strings.
  const strings: string[] = []
  const stringIndex = new Map<string, number>()
  let latest: EncodedVersion | undefined
  let previous: PatchBase | undefined

  const intern = (text: string): number => {
    let index = stringIndex.get(text)
    if (index === undefined) {
      index = strings.push(text) - 1
      stringIndex.set(text, index)
    }
    return index
  }

  const resolve = (world: World): EncodedVersion => {
    if (latest?.world === world) return latest
    const encoded = encodeVersion(world, intern)
    encoded.stringCount = strings.length
    if (!latest || world.version > latest.version) {
      if (latest) {
        const { version, stringCount, nodeKeys, edgeKeys } = latest
        previous = { version, stringCount, nodeKeys, edgeKeys }
      }
      latest = encoded
    }
    return encoded
  }

  return {
    session,
    encodeWorld(world, since) {
      const current = resolve(world)
      // A page that reconnects already holds this version.
      if (since?.session === session && since.version === current.version) {
        return JSON.stringify({
          type: 'patch',
          session,
          base: current.version,
          version: current.version,
          indexedAt: world.indexedAt,
          languages: world.languages,
          strings: [],
          nodes: [],
          edges: [],
        } satisfies WorldPatch)
      }
      if (
        since?.session === session &&
        previous &&
        current === latest &&
        since.version === previous.version
      ) {
        if (current.patch === undefined) {
          current.patch = encodePatch(session, previous, current, strings, maxEdits) ?? null
        }
        if (current.patch !== null) return current.patch
      }
      current.full ??= JSON.stringify({
        type: 'full',
        session,
        version: current.version,
        indexedAt: world.indexedAt,
        languages: world.languages,
        strings: strings.slice(0, current.stringCount),
        nodes: current.rows,
        edges: current.edges,
      } satisfies WorldPayload)
      return current.full
    },
    encodeSymbols(world, held, files) {
      if (held.session !== session || held.version !== world.version) return undefined
      const current = resolve(world)
      const response: SymbolsResponse = { version: world.version, files: {} }
      for (const index of files) {
        const rows = current.symbols.get(index)
        if (rows) response.files[index] = rows
      }
      return response
    },
  }
}

function encodeVersion(world: World, intern: (text: string) => number): EncodedVersion {
  const byId = new Map<string, WorldNode>()
  for (const node of world.nodes) byId.set(node.id, node)

  // Nodes other than symbols that hang off the root, in world order, which
  // puts every parent before its children.
  const skeleton: WorldNode[] = []
  const indexOf = new Map<string, number>()
  const root = world.nodes.find((node) => node.parent === undefined)
  for (const node of world.nodes) {
    const isPlaced = node === root || (node.parent !== undefined && indexOf.has(node.parent))
    if (node.kind === 'symbol' || !isPlaced) continue
    indexOf.set(node.id, skeleton.push(node) - 1)
  }
  const early = world.nodes.find(
    (node) =>
      node.kind !== 'symbol' &&
      !indexOf.has(node.id) &&
      node.parent !== undefined &&
      indexOf.has(node.parent),
  )
  if (early) {
    throw new WorldEncodeError(
      `node ${early.id} comes before its parent ${early.parent} in world order`,
      'ParentAfterChild',
    )
  }

  // Every symbol under each file, in world order, with its position there.
  const fileOf = new Map<string, number>()
  const symbolNodes = new Map<number, WorldNode[]>()
  const positionOf = new Map<string, number>()
  for (const node of world.nodes) {
    if (node.kind !== 'symbol') continue
    let holder = node.parent ? byId.get(node.parent) : undefined
    while (holder?.kind === 'symbol') holder = holder.parent ? byId.get(holder.parent) : undefined
    const file = holder ? indexOf.get(holder.id) : undefined
    if (file === undefined) continue
    fileOf.set(node.id, file)
    let list = symbolNodes.get(file)
    if (!list) {
      list = []
      symbolNodes.set(file, list)
    }
    positionOf.set(node.id, list.push(node) - 1)
  }
  const symbols = new Map<number, SymbolRow[]>()
  for (const [file, list] of symbolNodes) {
    const fileId = (skeleton[file] as WorldNode).id
    symbols.set(
      file,
      list.map((node) => {
        const qualified = node.id.slice(fileId.length + 1)
        return [
          node.parent ? (positionOf.get(node.parent) ?? -1) : -1,
          qualified,
          node.name === qualified ? null : node.name,
          SYMBOL_KINDS.indexOf(node.symbolKind ?? 'function'),
          node.range?.start ?? 1,
          node.range?.end ?? 1,
          node.exported === undefined ? -1 : node.exported ? 1 : 0,
          node.complexity,
        ]
      }),
    )
  }

  const rows = skeleton.map((node): NodeRow => {
    const parent = node.parent ? byId.get(node.parent) : undefined
    const parentId = parent?.id ?? ''
    let cut = 0
    while (cut < parentId.length && parentId[cut] === node.id[cut]) cut++
    const tail = node.id.slice(cut)
    let path: number | string | null = null
    if (node.path !== undefined) {
      const at = node.id.length - node.path.length
      path = at >= 0 && node.id.endsWith(node.path) ? at : node.path
    }
    const rect = quantizeRect(node)
    const origin = parent ? quantizeRect(parent) : { x: 0, y: 0 }
    const rows = symbols.get(indexOf.get(node.id) as number)
    const extra: NodeExtra = {}
    if (node.language !== undefined) extra.language = node.language
    if (node.package !== undefined) extra.package = node.package
    if (node.commit !== undefined) extra.commit = node.commit
    if (node.transports !== undefined) extra.transports = node.transports
    return [
      parent ? (indexOf.get(parent.id) as number) : -1,
      NODE_KINDS.indexOf(node.kind),
      cut,
      tail,
      node.name === tail ? null : node.name,
      path,
      rect.x - origin.x,
      rect.y - origin.y,
      rect.w,
      rect.h,
      node.lines,
      node.complexity,
      rows?.length ?? 0,
      rows ? hashText(JSON.stringify(rows)) : '',
      Object.keys(extra).length > 0 ? extra : null,
    ]
  })

  // An edge end: [node index, symbol string index or -1].
  const end = (id: string): [number, number] => {
    const node = indexOf.get(id)
    if (node !== undefined) return [node, -1]
    const file = fileOf.get(id)
    if (file === undefined) return [-1, intern(id)]
    return [file, intern(id.slice((skeleton[file] as WorldNode).id.length + 1))]
  }
  const edges: number[] = []
  for (const edge of world.edges) {
    const [from, fromSymbol] = end(edge.from)
    const [to, toSymbol] = end(edge.to)
    const typeOnly = edge.typeOnly === undefined ? 0 : edge.typeOnly ? 2 : 1
    const code =
      EDGE_KINDS.indexOf(edge.kind) | (PROVENANCES.indexOf(edge.provenance) << 3) | (typeOnly << 5)
    let atFile = -1
    if (edge.at) {
      const file = indexOf.get(edge.at.file)
      atFile = file === undefined ? -3 - intern(edge.at.file) : file === from ? AT_FROM : file
    }
    edges.push(
      from,
      fromSymbol,
      to,
      toSymbol,
      code,
      edge.label === undefined ? -1 : intern(edge.label),
      atFile,
      edge.at?.line ?? 0,
    )
  }

  return {
    version: world.version,
    world,
    stringCount: 0,
    rows,
    edges,
    nodeKeys: rows.map((row, i) => {
      const parent = row[0] >= 0 ? (skeleton[row[0]] as WorldNode).id : ''
      return `${parent}\n${JSON.stringify(row.slice(1))}\n${(skeleton[i] as WorldNode).id}`
    }),
    edgeKeys: world.edges.map(edgeKey),
    symbols,
  }
}

function encodePatch(
  session: string,
  base: PatchBase,
  next: EncodedVersion,
  strings: readonly string[],
  maxEdits: number,
): string | undefined {
  const nodeEdits = diffSequences(base.nodeKeys, next.nodeKeys, maxEdits)
  if (!nodeEdits) return undefined
  const edgeEdits = diffSequences(base.edgeKeys, next.edgeKeys, maxEdits)
  if (!edgeEdits) return undefined
  const toSplice = <T>(edit: SequenceEdit, item: (i: number) => T): Splice<T> => [
    edit.at,
    edit.deleteCount,
    Array.from({ length: edit.insertCount }, (_, i) => item(edit.insertStart + i)),
  ]
  const patch: WorldPatch = {
    type: 'patch',
    session,
    base: base.version,
    version: next.version,
    indexedAt: next.world.indexedAt,
    languages: next.world.languages,
    strings: strings.slice(base.stringCount, next.stringCount),
    nodes: nodeEdits.map((edit) => toSplice(edit, (i) => next.rows[i] as NodeRow)),
    edges: edgeEdits.map((edit) =>
      toSplice(edit, (i) => next.edges.slice(i * EDGE_STRIDE, (i + 1) * EDGE_STRIDE)),
    ),
  }
  return JSON.stringify(patch)
}

function edgeKey(edge: Edge): string {
  const optional = (value: string | number | boolean | undefined) =>
    value === undefined ? MISSING : String(value)
  return [
    edge.from,
    edge.to,
    edge.kind,
    edge.provenance,
    optional(edge.label),
    optional(edge.at?.file),
    optional(edge.at?.line),
    optional(edge.typeOnly),
  ].join('\n')
}

function quantizeRect(node: WorldNode): { x: number; y: number; w: number; h: number } {
  const q = (value: number) => Math.round(value * RECT_QUANTUM) / RECT_QUANTUM
  return { x: q(node.rect.x), y: q(node.rect.y), w: q(node.rect.w), h: q(node.rect.h) }
}

// FNV-1a, enough to tell whether a file's symbols changed.
function hashText(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}
