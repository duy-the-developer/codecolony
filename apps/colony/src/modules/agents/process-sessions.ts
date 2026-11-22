import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LiveSession, SessionSource } from './session-source.ts'

// Sessions from the process table: the working folder of every coding agent
// CLI that runs on this machine, read with `lsof`. It knows nothing of status,
// but it finds your own sessions without Herdr.

const run = promisify(execFile)
const TIMEOUT_MS = 5000
export const AGENT_COMMANDS = ['claude', 'codex', 'opencode', 'gemini', 'cursor-agent'] as const

export function createProcessSessions(): SessionSource {
  return {
    name: 'process',
    async listSessions() {
      const args = ['-a', '-d', 'cwd', '-w', '-F', 'pcn']
      for (const command of AGENT_COMMANDS) args.push('-c', command)
      try {
        const { stdout } = await run('lsof', args, { encoding: 'utf8', timeout: TIMEOUT_MS })
        return parseLsofCwds(stdout)
      } catch (error) {
        // lsof exits 1 when no process matched.
        const stdout = (error as { stdout?: unknown }).stdout
        return typeof stdout === 'string' ? parseLsofCwds(stdout) : []
      }
    },
  }
}

// `lsof -F pcn` prints one field per line: p<pid>, c<command>, then n<path>
// for the cwd descriptor.
export function parseLsofCwds(output: string): LiveSession[] {
  const sessions: LiveSession[] = []
  let command: string | undefined
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) command = undefined
    else if (line.startsWith('c')) command = line.slice(1)
    else if (line.startsWith('n') && command) {
      const agent = AGENT_COMMANDS.find((name) => command?.startsWith(name))
      if (agent) sessions.push({ cwd: line.slice(1), agent })
    }
  }
  return sessions
}
