import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../indexing/testing/git-fixture.ts'

// A synthetic firstmate home: state/<task>.meta and .status records, an
// optional data/backlog.md, and an empty projects/ folder to clone into.

export interface FakeTask {
  id: string
  // key=value lines of the meta record.
  meta: Record<string, string>
  status?: string[]
}

export function makeFirstmateHome(tasks: readonly FakeTask[] = []): string {
  const home = makeTempDir('codecolony-firstmate-')
  mkdirSync(join(home, 'state'), { recursive: true })
  mkdirSync(join(home, 'projects'), { recursive: true })
  for (const task of tasks) writeTask(home, task)
  return home
}

export function writeBacklog(home: string, text: string): void {
  mkdirSync(join(home, 'data'), { recursive: true })
  writeFileSync(join(home, 'data', 'backlog.md'), text)
}

// A backlog line holding a task for the captain, the way firstmate writes it.
export function captainHoldLine(id: string, reason: string): string {
  const hold = `fm-hold-v1:${Buffer.from(reason).toString('base64')}`
  return `- [ ] ${id} - A held task (repo: repo) (kind: ship) (hold: ${hold}) (hold-kind: captain)`
}

export function writeTask(home: string, task: FakeTask): void {
  const meta = Object.entries({ endpoint_task_id: task.id, ...task.meta })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  writeFileSync(join(home, 'state', `${task.id}.meta`), `${meta}\n`)
  if (task.status) {
    writeFileSync(join(home, 'state', `${task.id}.status`), `${task.status.join('\n')}\n`)
  }
}
