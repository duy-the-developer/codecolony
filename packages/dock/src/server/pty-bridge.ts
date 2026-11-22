import { type IPty, spawn } from 'node-pty'
import type { RawData, WebSocket } from 'ws'
import { parseControlMessage } from '../protocol/protocol.ts'

export interface PtyCommand {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

const INITIAL_COLS = 120
const INITIAL_ROWS = 24
// Pause the pty while this much output waits to reach the page.
const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024

// Runs one pty per WebSocket: binary frames go to the pty, pty output comes
// back as binary frames, and a text resize frame resizes the pty. Closing
// either side ends the other. Terminal data is never logged.
export function bridgePty(ws: WebSocket, command: PtyCommand, onEnd: () => void): void {
  let pty: IPty
  try {
    pty = spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      cwd: command.cwd,
      env: command.env,
    })
  } catch (error) {
    ws.send(Buffer.from(`\r\n[could not start ${command.file}: ${(error as Error).message}]\r\n`))
    ws.close(1011, 'pty failed')
    onEnd()
    return
  }

  let paused = false
  const resumeWhenDrained = () => {
    if (paused && ws.bufferedAmount < LOW_WATER) {
      paused = false
      pty.resume()
    }
  }
  pty.onData((data) => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(Buffer.from(data, 'utf8'), { binary: true }, resumeWhenDrained)
    if (!paused && ws.bufferedAmount > HIGH_WATER) {
      paused = true
      pty.pause()
    }
  })

  let exited = false
  pty.onExit(({ exitCode }) => {
    exited = true
    if (ws.readyState === ws.OPEN) {
      ws.send(Buffer.from(`\r\n[${command.file} exited with code ${exitCode}]\r\n`))
      ws.close(1000, 'pty exited')
    }
  })

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (exited) return
    if (isBinary) {
      pty.write(toBuffer(data))
      return
    }
    const message = parseControlMessage(toBuffer(data).toString('utf8'))
    if (message?.type === 'resize') pty.resize(message.cols, message.rows)
  })

  ws.on('close', () => {
    if (!exited) pty.kill()
    onEnd()
  })
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}
