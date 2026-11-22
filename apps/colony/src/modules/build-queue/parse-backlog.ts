// Firstmate's markdown backlog (data/backlog.md, the tasks-axi markdown
// backend): `## In flight`, `## Queued` and `## Done` sections of items like
//
//   - [ ] some-id - A title (#12) https://host/pull/3 (repo: app) (kind: ship) (since 2026-11-22)
//     indented note lines
//
// The `(key: value)` groups, and dates written `(since 2026-11-22)`, are the
// item's fields. Other sections,
// and the notes, are not orders.

export const BACKLOG_SECTIONS = ['in-flight', 'queued', 'done'] as const
export type BacklogSection = (typeof BACKLOG_SECTIONS)[number]

export interface BacklogEntry {
  id: string
  title: string
  section: BacklogSection
  // repo, kind, since, done, merged, reported, hold, hold-kind, priority, ...
  fields: Record<string, string>
  pullRequestUrl?: string
}

const SECTION_HEADINGS: Record<string, BacklogSection> = {
  'in flight': 'in-flight',
  queued: 'queued',
  done: 'done',
}
const ITEM = /^- \[[ xX]\] (\S+) - (.*)$/
const FIELD = /\s*\((?:([a-z][\w-]*): ([^()]*)|(since|done|merged|reported) (\d{4}-\d\d-\d\d))\)/g
const PULL_REQUEST_URL = /https?:\/\/\S+\/(?:pull|pulls|merge_requests)\/\d+/

export function parseBacklog(text: string): BacklogEntry[] {
  const entries: BacklogEntry[] = []
  let section: BacklogSection | undefined
  for (const line of text.split('\n')) {
    const heading = /^## (.+?)\s*$/.exec(line)
    if (heading?.[1]) {
      section = SECTION_HEADINGS[heading[1].toLowerCase()]
      continue
    }
    const item = section && ITEM.exec(line)
    if (!section || !item?.[1] || item[2] === undefined) continue
    entries.push(parseItem(item[1], item[2], section))
  }
  return entries
}

function parseItem(id: string, rest: string, section: BacklogSection): BacklogEntry {
  const fields: Record<string, string> = {}
  for (const [, key, value, dateKey, date] of rest.matchAll(FIELD)) {
    if (key && value !== undefined) fields[key] = value.trim()
    else if (dateKey && date) fields[dateKey] = date
  }
  const pullRequestUrl = PULL_REQUEST_URL.exec(rest)?.[0]
  let title = rest.replace(FIELD, '')
  if (pullRequestUrl) title = title.replace(pullRequestUrl, '')
  title = title.replace(/\s+/g, ' ').trim()
  return { id, title, section, fields, ...(pullRequestUrl ? { pullRequestUrl } : {}) }
}

// Held for the captain: an open item firstmate holds until you decide. A done
// item keeps its hold-kind after the answer, so it is no longer held.
export function isCaptainHeld(entry: BacklogEntry): boolean {
  return entry.section !== 'done' && entry.fields['hold-kind'] === 'captain'
}

// A firstmate hold field is `fm-hold-v1:<base64 reason>`; anything else is
// taken as written.
export function holdReason(hold: string | undefined): string | undefined {
  if (!hold) return undefined
  const encoded = /^fm-hold-v\d+:(.*)$/.exec(hold)?.[1]
  if (encoded === undefined) return hold
  const reason = Buffer.from(encoded, 'base64').toString('utf8').trim()
  return reason || undefined
}
