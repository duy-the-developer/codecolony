import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type CaptainHold,
  loadCaptainHolds,
  parseMeta,
  parseStatusLog,
  type WorkerStatus,
} from '../build-queue/load-build-queue.ts'

// Reads a firstmate home, read only: each running task's record in
// `state/<task>.meta` (key=value lines: the worktree it works in, its kind,
// branch) and its status log in `state/<task>.status`, read the way the build
// queue reads it, and whether the backlog (data/backlog.md) holds it for the
// captain, plus the clones under `projects/`. A missing or unreadable home
// reads as empty.

export interface FirstmateTask {
  id: string
  worktree?: string
  kind?: string
  branch?: string
  // Its status log, when it has written one.
  status?: WorkerStatus
  // Set while the backlog holds the task for the captain.
  captainHold?: CaptainHold
}

export async function readFirstmateTasks(home: string): Promise<FirstmateTask[]> {
  const state = join(home, 'state')
  let names: string[]
  try {
    names = await readdir(state)
  } catch {
    return []
  }
  const holds = await loadCaptainHolds(home).catch(() => new Map<string, CaptainHold>())
  const tasks = await Promise.all(
    names
      .filter((name) => name.endsWith('.meta'))
      .sort()
      .map(async (name): Promise<FirstmateTask | undefined> => {
        const meta = await readText(join(state, name))
        if (meta === undefined) return undefined
        const fields = parseMeta(meta)
        const id = fields.endpoint_task_id ?? name.slice(0, -'.meta'.length)
        const task: FirstmateTask = { id }
        if (fields.worktree) task.worktree = fields.worktree
        if (fields.kind) task.kind = fields.kind
        if (fields.branch) task.branch = fields.branch
        const log = await readText(join(state, `${id}.status`))
        if (log !== undefined) task.status = parseStatusLog(log)
        const hold = holds.get(id)
        if (hold) task.captainHold = hold
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

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}
