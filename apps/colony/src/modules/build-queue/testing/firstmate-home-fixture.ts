import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A fake firstmate home for tests: a backlog and, per running worker, its
// meta and status records. Never point tests at a real firstmate home.

export interface FakeWorker {
  // state/<id>.meta key=value fields; worktree is the worker's copy.
  meta?: Record<string, string>
  // state/<id>.status lines.
  status?: string[]
}

export interface FirstmateHomeOptions {
  backlog?: string
  workers?: Record<string, FakeWorker>
}

export function makeFirstmateHome({ backlog, workers = {} }: FirstmateHomeOptions = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'codecolony-firstmate-'))
  mkdirSync(join(home, 'data'))
  mkdirSync(join(home, 'state'))
  if (backlog !== undefined) writeFileSync(join(home, 'data', 'backlog.md'), backlog)
  for (const [id, worker] of Object.entries(workers)) writeWorker(home, id, worker)
  return home
}

export function writeWorker(home: string, id: string, { meta = {}, status }: FakeWorker): void {
  const lines = Object.entries({ kind: 'ship', ...meta }).map(([key, value]) => `${key}=${value}`)
  writeFileSync(join(home, 'state', `${id}.meta`), `${lines.join('\n')}\n`)
  if (status) writeFileSync(join(home, 'state', `${id}.status`), `${status.join('\n')}\n`)
}

export const FAKE_BACKLOG = `# Backlog

## In flight
- [ ] app-colonists - App: colonists on the map (#43) (repo: app) (kind: ship) (since 2026-11-21)
  Captain decision:
  - [ ] not an item, an indented note
- [ ] app-roadmap - App: approve the roadmap (repo: app) (kind: captain) (since 2026-11-20) (hold: fm-hold-v1:${Buffer.from('Approve the C1-C13 order').toString('base64')}) (hold-kind: captain)
- [ ] app-queue - App: build queue (#44) (repo: app) (kind: ship) (since 2026-11-22)
- [ ] other-site - Other: a site for someone else (repo: other) (kind: ship) (since 2026-11-22)
## Queued
- [ ] app-wiring - App: file wiring (#58) blocked-by: app-colonists (repo: app) (kind: ship) (since 2026-11-19) (hold: Held until you approve the mockup)
- [ ] no-repo - A captain to-do without a repo (kind: captain) (since 2026-11-01)
## Notes
- [ ] app-not-an-order - Not in a known section (repo: app)
## Done
- [x] app-selection - App: multi-select (#57) https://github.com/acme/app/pull/63 (repo: app) (kind: ship) (merged 2026-11-22)
- [x] app-mockup - App: mockup round 4 data/app-mockup/report.md (repo: app) (kind: scout) (reported 2026-11-21)
`
