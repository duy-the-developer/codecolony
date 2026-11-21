import { type ChildProcess, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
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
import type { LanguageServerSpec } from './language-adapter.ts'

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

export interface LspExit {
  code: number | null
  signal: NodeJS.Signals | null
  // True when close() asked for it.
  requested: boolean
}

export interface LspSessionOptions {
  // Each line the server writes to stderr (crash reports land here).
  onStderr?(line: string): void
  // Called once when the server process is gone.
  onExit?(exit: LspExit): void
  // Until the first call-hierarchy answer: the server is loading the project,
  // which takes tens of seconds on a large repository.
  loadTimeoutMs?: number
  requestTimeoutMs?: number
}

export type LspErrorCode = 'EmptyCommand' | 'NoStdio' | 'Timeout' | 'Exited'

export class LspError extends Error {
  override name = 'LspError'
  readonly code: LspErrorCode
  constructor(code: LspErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

const LOAD_TIMEOUT_MS = 180_000
const REQUEST_TIMEOUT_MS = 20_000

export class LspSession {
  private readonly opened = new Map<string, { version: number; text: string }>()
  private readonly exited: Promise<never>
  private alive = true
  private loaded = false
  private closing = false

  private constructor(
    private readonly spec: LanguageServerSpec,
    private readonly process: ChildProcess,
    private readonly connection: ProtocolConnection,
    private readonly options: LspSessionOptions,
  ) {
    this.exited = new Promise<never>((_, reject) => {
      let done = false
      const finish = (code: number | null, signal: NodeJS.Signals | null, cause?: Error) => {
        if (done) return
        done = true
        this.alive = false
        reject(
          new LspError('Exited', `language server exited (code ${code}, signal ${signal})`, {
            cause,
          }),
        )
        options.onExit?.({ code, signal, requested: this.closing })
      }
      process.once('exit', (code, signal) => finish(code, signal))
      process.once('error', (error) => finish(null, null, error))
    })
    // Requests race this promise; nobody else awaits it.
    this.exited.catch(() => {})
  }

  static async start(
    spec: LanguageServerSpec,
    rootDir: string,
    options: LspSessionOptions = {},
  ): Promise<LspSession> {
    const [command, ...args] = spec.command()
    if (!command) throw new LspError('EmptyCommand', 'language server command is empty')
    const child = spawn(command, args, { cwd: rootDir, stdio: ['pipe', 'pipe', 'pipe'] })
    if (!child.stdout || !child.stdin || !child.stderr) {
      child.kill()
      throw new LspError('NoStdio', `${command}: no stdio`)
    }
    // Writes to a server that already died fail here; the exit rejects the request.
    child.stdin.on('error', () => {})
    const stderr = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY })
    stderr.on('line', (line) => options.onStderr?.(line))
    const connection = createProtocolConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    )
    connection.listen()
    const session = new LspSession(spec, child, connection, options)
    const rootUri = pathToFileURL(rootDir).href
    try {
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
    } catch (error) {
      await session.close()
      throw error
    }
    return session
  }

  // False once the server process has exited; start a new session then.
  get isAlive(): boolean {
    return this.alive
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
    this.loaded = true
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
    this.closing = true
    if (this.alive) {
      try {
        await this.request(this.connection.sendRequest(ShutdownRequest.type), 'shutdown')
        await this.connection.sendNotification(ExitNotification.type)
      } catch {
        // The process is killed below either way.
      }
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

  // Settles with the answer, a timeout, or the server's exit, whichever is first.
  private async request<T>(pending: Promise<T>, what: string): Promise<T> {
    const ms = this.loaded
      ? (this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
      : (this.options.loadTimeoutMs ?? LOAD_TIMEOUT_MS)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new LspError('Timeout', `language server: ${what} timed out after ${ms} ms`)),
        ms,
      )
    })
    try {
      return await Promise.race([pending, timeout, this.exited])
    } finally {
      clearTimeout(timer)
    }
  }
}
