import { type ChildProcess, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  createProtocolConnection,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  type ProtocolConnection,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node'
import type { LanguageServerSpec } from './adapter.ts'

// A language-agnostic LSP client over stdio: the semantic half of every
// language adapter. Paths are absolute; lines are 1-based and columns 0-based.

export interface SourcePoint {
  path: string
  line: number
  column: number
}

export interface OutgoingCall {
  name: string
  // Where the callee is declared.
  target: SourcePoint
  // Lines in the calling file where the call happens.
  lines: number[]
}

const REQUEST_TIMEOUT_MS = 20_000

export class LspSession {
  private readonly opened = new Map<string, { version: number; text: string }>()

  private constructor(
    private readonly spec: LanguageServerSpec,
    private readonly process: ChildProcess,
    private readonly connection: ProtocolConnection,
  ) {}

  static async start(spec: LanguageServerSpec, rootDir: string): Promise<LspSession> {
    const [command, ...args] = spec.command()
    if (!command) throw new Error('language server command is empty')
    const child = spawn(command, args, { cwd: rootDir, stdio: ['pipe', 'pipe', 'ignore'] })
    if (!child.stdout || !child.stdin) throw new Error(`${command}: no stdio`)
    const connection = createProtocolConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    )
    connection.listen()
    const session = new LspSession(spec, child, connection)
    const rootUri = pathToFileURL(rootDir).href
    await session.request(
      connection.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: 'root' }],
        capabilities: {
          textDocument: {
            callHierarchy: { dynamicRegistration: false },
          },
        },
        initializationOptions: spec.initializationOptions?.(),
      }),
      'initialize',
    )
    await connection.sendNotification(InitializedNotification.type, {})
    return session
  }

  // The outgoing calls of the function or method named `name` declared at
  // `at`; none when the server resolves a different symbol there.
  async outgoingCalls(at: SourcePoint, name: string): Promise<OutgoingCall[]> {
    const uri = await this.open(at.path)
    const items = await this.request(
      this.connection.sendRequest(CallHierarchyPrepareRequest.type, {
        textDocument: { uri },
        position: { line: at.line - 1, character: at.column },
      }),
      'prepareCallHierarchy',
    )
    const item = items?.[0]
    if (item?.name !== name) return []
    const calls = await this.request(
      this.connection.sendRequest(CallHierarchyOutgoingCallsRequest.type, { item }),
      'outgoingCalls',
    )
    return (calls ?? []).map((call) => ({
      name: call.to.name,
      target: {
        path: fileURLToPath(call.to.uri),
        line: call.to.selectionRange.start.line + 1,
        column: call.to.selectionRange.start.character,
      },
      lines: call.fromRanges.map((range) => range.start.line + 1),
    }))
  }

  async close(): Promise<void> {
    try {
      await this.request(this.connection.sendRequest(ShutdownRequest.type), 'shutdown')
      await this.connection.sendNotification(ExitNotification.type)
    } catch {
      // The process is killed below either way.
    }
    this.connection.dispose()
    this.process.kill()
  }

  // Sends the file's current text, so positions read from it now match.
  private async open(path: string): Promise<string> {
    const uri = pathToFileURL(path).href
    const text = await readFile(path, 'utf8')
    const document = this.opened.get(uri)
    if (!document) {
      this.opened.set(uri, { version: 1, text })
      await this.connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: this.spec.languageId(path), version: 1, text },
      })
    } else if (document.text !== text) {
      document.version += 1
      document.text = text
      await this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version: document.version },
        contentChanges: [{ text }],
      })
    }
    return uri
  }

  private async request<T>(pending: Promise<T>, what: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`language server: ${what} timed out`)),
        REQUEST_TIMEOUT_MS,
      )
    })
    try {
      return await Promise.race([pending, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}
