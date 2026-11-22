import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Reads a firstmate home, read only: each running task's record in
// `state/<task>.meta` (key=value lines: the worktree it works in, its kind,
// branch) and the status lines it appends to `state/<task>.status`
// (`<state> [key=value]... : <text>`), plus the clones under `projects/`.
// A missing or unreadable home reads as empty.

export interface StatusLine {
  // working, paused, needs-decision, blocked, failed, done, progress, ...
  state: string
  text: string
  // Seconds since the epoch, from `[at=<epoch>]`.
  at?: number
}

export interface FirstmateTask {
  id: string
  worktree?: string
  kind?: string
  branch?: string
  // The last status line it reported.
  status?: StatusLine
  // The newest pull request URL in its status lines.
  pr?: string
}

const STATUS_LINE = /^([a-z][a-z-]*)((?:\s*\[[^\]]*\])*)\s*:\s?(.*)$/
const AT_TAG = /\[at=(\d+)\]/
const PR_URL = /https?:\/\/\S+?\/(?:pull|pulls|merge_requests)\/\d+/g

export async function readFirstmateTasks(home: string): Promise<FirstmateTask[]> {
  const state = join(home, 'state')
  let names: string[]
  try {
    names = await readdir(state)
  } catch {
    return []
  }
  const tasks = await Promise.all(
    names
      .filter((name) => name.endsWith('.meta'))
      .sort()
      .map(async (name): Promise<FirstmateTask | undefined> => {
        const meta = await readText(join(state, name))
        if (meta === undefined) return undefined
        const fields = parseMeta(meta)
        const id = fields.get('endpoint_task_id') ?? name.slice(0, -'.meta'.length)
        const task: FirstmateTask = { id }
        const worktree = fields.get('worktree')
        if (worktree) task.worktree = worktree
        const kind = fields.get('kind')
        if (kind) task.kind = kind
        const branch = fields.get('branch')
        if (branch) task.branch = branch
        const lines = (await readText(join(state, `${id}.status`)))?.split('\n') ?? []
        const parsed = lines.map(parseStatusLine).filter((line) => line !== undefined)
        const last = parsed.at(-1)
        if (last) task.status = last
        const pr = parsed
          .map((line) => findPullRequestUrl(line.text))
          .filter((url) => url !== undefined)
          .at(-1)
        if (pr) task.pr = pr
        return task
      }),
  )
  return tasks.filter((task) => task !== undefined)
}

// The clones firstmate works from: `projects/<name>`.
export async function listFirstmateClones(home: string): Promise<string[]> {
  const projects = join(home, 'projects')
  try {
    const entries = await readdir(projects, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(projects, entry.name))
      .sort()
  } catch {
    return []
  }
}

export function parseMeta(text: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return fields
}

export function parseStatusLine(line: string): StatusLine | undefined {
  const match = STATUS_LINE.exec(line.trim())
  if (!match) return undefined
  const status: StatusLine = { state: match[1] as string, text: (match[3] ?? '').trim() }
  const at = AT_TAG.exec(match[2] ?? '')
  if (at) status.at = Number(at[1])
  return status
}

// The last pull or merge request URL in a text.
export function findPullRequestUrl(text: string): string | undefined {
  return text.match(PR_URL)?.at(-1)
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}
