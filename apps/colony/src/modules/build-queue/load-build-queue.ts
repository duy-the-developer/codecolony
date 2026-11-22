import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  BuildOrder,
  OrderChangesResponse,
  OrderState,
  ProjectKind,
} from '../wire/api-types.ts'
import { type BacklogEntry, holdReason, parseBacklog } from './parse-backlog.ts'
import { parseStatusLog, type WorkerStatus } from './parse-status-log.ts'

// The build queue, read from a firstmate home and never written: the backlog
// (data/backlog.md) gives the orders, and each running worker's records
// (state/<id>.meta, state/<id>.status) give its state, note and PR.

const run = promisify(execFile)
const TASK_ID = /^[\w.-]+$/
const MAX_NOTE_CHARS = 400
const MAX_CHANGED_PATHS = 2000
const ACTIVE_ORDER: readonly OrderState[] = ['waiting', 'blocked', 'pr-ready', 'working']

export interface QueueProject {
  name: string
  root: string
  kind: ProjectKind
}

interface Worker {
  status: WorkerStatus
  worktree?: string
}

// Orders whose backlog repo is on the map: Active sorted by state (waiting,
// blocked, PR ready, working), then Queued and Done in backlog order. A
// missing backlog is an empty queue.
export async function loadBuildQueue(
  home: string,
  projects: readonly QueueProject[],
): Promise<BuildOrder[]> {
  const backlog = await readOptional(join(home, 'data', 'backlog.md'))
  const orders: BuildOrder[] = []
  for (const entry of parseBacklog(backlog ?? '')) {
    const project = findProject(entry.fields.repo, projects)
    if (!project) continue
    const worker = entry.section === 'done' ? undefined : await loadWorker(home, entry.id)
    orders.push(buildOrder(entry, project, worker))
  }
  const rank = (order: BuildOrder) =>
    order.section === 'active' ? ACTIVE_ORDER.indexOf(order.state) : ACTIVE_ORDER.length
  return orders
    .map((order, index) => ({ order, index }))
    .sort((a, b) => rank(a.order) - rank(b.order) || a.index - b.index)
    .map(({ order }) => order)
}

// The files an order's worker changed against its main branch: committed on
// its branch, staged, unstaged or untracked. Undefined when the order has no
// worker copy to read.
export async function loadOrderChanges(
  home: string,
  projects: readonly QueueProject[],
  id: string,
): Promise<OrderChangesResponse | undefined> {
  if (!TASK_ID.test(id)) return undefined
  const backlog = await readOptional(join(home, 'data', 'backlog.md'))
  const entry = parseBacklog(backlog ?? '').find((e) => e.id === id && e.section !== 'done')
  const project = findProject(entry?.fields.repo, projects)
  const worker = await loadWorker(home, id)
  if (!entry?.fields.repo || !project || !worker?.worktree) return undefined
  const paths = await readChangedPaths(worker.worktree)
  return { project: project.name, repo: entry.fields.repo, paths }
}

function buildOrder(entry: BacklogEntry, project: QueueProject, worker: Worker | undefined) {
  const { fields } = entry
  const order: BuildOrder = {
    id: entry.id,
    title: entry.title,
    section: entry.section === 'in-flight' ? 'active' : entry.section,
    state: 'queued',
    project: project.name,
    hasWorktree: worker?.worktree !== undefined,
  }
  if (fields.kind) order.kind = fields.kind
  let note: string | undefined
  let pullRequestUrl = entry.pullRequestUrl
  if (entry.section === 'done') {
    order.state = 'done'
    const date = fields.merged ?? fields.done ?? fields.reported
    if (date) order.date = date
  } else {
    if (fields.since) order.date = fields.since
    const isCaptainHeld = fields['hold-kind'] === 'captain'
    if (worker) {
      order.colonist = entry.id
      note = worker.status.note
      pullRequestUrl = worker.status.pullRequestUrl ?? pullRequestUrl
    }
    note ??= holdReason(fields.hold)
    if (entry.section === 'in-flight') {
      order.state = worker ? worker.status.state : isCaptainHeld ? 'waiting' : 'working'
      if (!worker && isCaptainHeld) note ??= 'Your decision; no colonist needed'
    }
  }
  if (pullRequestUrl) order.pullRequestUrl = pullRequestUrl
  if (note) order.note = truncate(note, MAX_NOTE_CHARS)
  return order
}

// The backlog names a firstmate project: the map's project of that name, or a
// folder-of-repositories project that holds a repository of that name.
function findProject(
  repo: string | undefined,
  projects: readonly QueueProject[],
): QueueProject | undefined {
  if (!repo || !TASK_ID.test(repo)) return undefined
  return (
    projects.find((project) => project.name === repo) ??
    projects.find((project) => project.kind === 'repos' && existsSync(join(project.root, repo)))
  )
}

// A worker runs the order while firstmate keeps its meta record.
async function loadWorker(home: string, id: string): Promise<Worker | undefined> {
  const meta = await readOptional(join(home, 'state', `${id}.meta`))
  if (meta === undefined) return undefined
  const status = parseStatusLog((await readOptional(join(home, 'state', `${id}.status`))) ?? '')
  const worktree = parseMeta(meta).worktree
  return { status, ...(worktree && existsSync(worktree) ? { worktree } : {}) }
}

// key=value lines.
function parseMeta(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return fields
}

async function readChangedPaths(worktree: string): Promise<string[]> {
  const base = await findMergeBase(worktree)
  const [changed, untracked] = await Promise.all([
    git(worktree, ['diff', '--name-only', '--no-renames', base ?? 'HEAD']),
    git(worktree, ['ls-files', '--others', '--exclude-standard']),
  ])
  const paths = new Set([...lines(changed), ...lines(untracked)])
  return [...paths].sort().slice(0, MAX_CHANGED_PATHS)
}

// Where the worker's branch left the main branch: the remote's default
// branch, else a local main or master.
async function findMergeBase(worktree: string): Promise<string | undefined> {
  const remoteHead = (
    await git(worktree, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  ).trim()
  for (const branch of [remoteHead, 'origin/main', 'origin/master', 'main', 'master']) {
    if (!branch) continue
    const base = (await git(worktree, ['merge-base', 'HEAD', branch])).trim()
    if (base) return base
  }
  return undefined
}

// git's output, or '' when it fails (no such ref, not a repository).
async function git(dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch {
    return ''
  }
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '')
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
