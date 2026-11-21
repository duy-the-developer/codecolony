import {
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  createProtocolConnection,
  ExitNotification,
  InitializeRequest,
  type Range,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node'
import type { FakeLspBehavior } from '../fake-lsp.ts'

// A language server for tests: every position is a function named `caller`
// that calls `callee-<pid>`, so a test can tell a restarted server apart.
// Its behavior comes as JSON in the first argument.

const behavior: FakeLspBehavior = JSON.parse(process.argv[2] ?? '{}')
const RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
const SYMBOL_KIND_FUNCTION = 12

const connection = createProtocolConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
)
let prepares = 0

connection.onRequest(InitializeRequest.type, () => ({
  capabilities: { callHierarchyProvider: true },
}))

connection.onRequest(CallHierarchyPrepareRequest.type, async ({ textDocument }) => {
  prepares += 1
  if (prepares === behavior.crashOnPrepare) {
    process.stderr.write('FATAL ERROR: Reached heap limit Allocation failed\n')
    process.exit(134)
  }
  await new Promise((resolve) => setTimeout(resolve, behavior.prepareDelaysMs?.[prepares - 1] ?? 0))
  return [
    {
      name: 'caller',
      kind: SYMBOL_KIND_FUNCTION,
      uri: textDocument.uri,
      range: RANGE,
      selectionRange: RANGE,
    },
  ]
})

connection.onRequest(CallHierarchyOutgoingCallsRequest.type, ({ item }) => [
  {
    to: {
      name: `callee-${process.pid}`,
      kind: SYMBOL_KIND_FUNCTION,
      uri: item.uri,
      range: RANGE,
      selectionRange: RANGE,
    },
    fromRanges: [RANGE],
  },
])

connection.onRequest(ShutdownRequest.type, () =>
  behavior.hangOnShutdown ? new Promise<undefined>(() => {}) : undefined,
)
connection.onNotification(ExitNotification.type, () => process.exit(0))
connection.onClose(() => process.exit(0))
connection.listen()
process.stderr.write(`fake language server ${process.pid} listening\n`)
