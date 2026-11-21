import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

// Which Herdr session the dock attaches to, and how. The same settings come
// from command-line flags (see DOCK_CLI_OPTIONS) or the environment.

export interface DockOptions {
  // The Herdr session; null is Herdr's default session.
  session: string | null
  // The session's API socket.
  socketPath: string
  // The real Herdr client the terminal runs.
  client: { file: string; args: string[] }
  cwd: string
  // Lab mode: only sessions named fm-lab-* are allowed.
  lab: boolean
}

export class DockOptionsError extends Error {
  override name = 'DockOptionsError'
}

// For node:util parseArgs, merged into the host app's own options.
export const DOCK_CLI_OPTIONS = {
  'herdr-session': { type: 'string' },
  'herdr-socket': { type: 'string' },
  'herdr-bin': { type: 'string' },
  'herdr-lab': { type: 'boolean' },
} as const

export interface DockCliValues {
  'herdr-session'?: string | undefined
  'herdr-socket'?: string | undefined
  'herdr-bin'?: string | undefined
  'herdr-lab'?: boolean | undefined
}

const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const LAB_SESSION_NAME = /^fm-lab-[A-Za-z0-9][A-Za-z0-9_-]*$/

export function resolveDockOptions(
  values: DockCliValues,
  env: NodeJS.ProcessEnv = process.env,
): DockOptions {
  const lab = values['herdr-lab'] ?? env.CODECOLONY_HERDR_LAB === '1'
  const rawSession = values['herdr-session'] ?? env.CODECOLONY_HERDR_SESSION
  const socket = values['herdr-socket'] ?? env.CODECOLONY_HERDR_SOCKET
  const bin = values['herdr-bin'] ?? env.CODECOLONY_HERDR_BIN ?? 'herdr'

  if (rawSession !== undefined && !SESSION_NAME.test(rawSession)) {
    throw new DockOptionsError(`Herdr session name is not valid: ${JSON.stringify(rawSession)}`)
  }
  const session = rawSession === undefined || rawSession === 'default' ? null : rawSession
  if (lab) {
    // Lab mode never reaches the default session or any session outside the lab.
    if (session === null || !LAB_SESSION_NAME.test(session)) {
      throw new DockOptionsError(
        `lab mode only attaches to sessions named fm-lab-*, refusing ${session ?? 'the default session'}`,
      )
    }
    if (socket !== undefined) {
      throw new DockOptionsError(
        'lab mode derives the socket from the session; drop --herdr-socket',
      )
    }
  }
  if (socket !== undefined && !isAbsolute(socket)) {
    throw new DockOptionsError(`Herdr socket must be an absolute path: ${socket}`)
  }

  return {
    session,
    socketPath: socket ?? herdrSocketPath(session, env),
    client: { file: bin, args: session === null ? [] : ['--session', session] },
    cwd: env.HOME ?? homedir(),
    lab,
  }
}

// Herdr keeps the default session's socket at <config>/herdr.sock and a named
// session's at <config>/sessions/<name>/herdr.sock.
export function herdrSocketPath(session: string | null, env: NodeJS.ProcessEnv): string {
  const config = join(env.XDG_CONFIG_HOME || join(env.HOME ?? homedir(), '.config'), 'herdr')
  return session === null
    ? join(config, 'herdr.sock')
    : join(config, 'sessions', session, 'herdr.sock')
}

// The client's environment, without the HERDR_* variables a pane inherits from
// the session it runs in; those would point the client at that session.
export function clientEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !key.startsWith('HERDR_')) clean[key] = value
  }
  clean.TERM = 'xterm-256color'
  clean.COLORTERM = 'truecolor'
  return clean
}
