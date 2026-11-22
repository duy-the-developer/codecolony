import { describe, expect, it } from 'vitest'
import { holdReason, isCaptainHeld, parseBacklog } from './parse-backlog.ts'
import { FAKE_BACKLOG } from './testing/firstmate-home-fixture.ts'

describe('parseBacklog', () => {
  it('reads the items of the In flight, Queued and Done sections only', () => {
    const entries = parseBacklog(FAKE_BACKLOG)
    expect(entries.map((entry) => [entry.section, entry.id])).toEqual([
      ['in-flight', 'app-colonists'],
      ['in-flight', 'app-roadmap'],
      ['in-flight', 'app-queue'],
      ['in-flight', 'other-site'],
      ['queued', 'app-wiring'],
      ['queued', 'no-repo'],
      ['done', 'app-selection'],
      ['done', 'app-mockup'],
    ])
  })

  it('splits the trailing fields and the PR link off the title', () => {
    const [selection] = parseBacklog(FAKE_BACKLOG).filter((e) => e.id === 'app-selection')
    expect(selection).toEqual({
      id: 'app-selection',
      title: 'App: multi-select (#57)',
      section: 'done',
      fields: { repo: 'app', kind: 'ship', merged: '2026-11-22' },
      pullRequestUrl: 'https://github.com/acme/app/pull/63',
    })
  })

  it('keeps parentheses that are not fields in the title', () => {
    const wiring = parseBacklog(FAKE_BACKLOG).find((e) => e.id === 'app-wiring')
    expect(wiring?.title).toBe('App: file wiring (#58) blocked-by: app-colonists')
    expect(wiring?.fields).toEqual({
      repo: 'app',
      kind: 'ship',
      since: '2026-11-19',
      hold: 'Held until you approve the mockup',
    })
  })
})

describe('isCaptainHeld', () => {
  it('holds open items held for the captain, not answered or other holds', () => {
    const held = parseBacklog(
      [
        '## In flight',
        '- [ ] a - Waits on you (hold: fm-hold-v1:eA==) (hold-kind: captain)',
        '- [ ] b - Held for a dependency (hold: until #44 lands)',
        '## Queued',
        '- [ ] c - Queued for you (hold-kind: captain)',
        '## Done',
        '- [x] d - Answered (hold-kind: captain) (done 2026-11-22)',
      ].join('\n'),
    ).filter(isCaptainHeld)
    expect(held.map((entry) => entry.id)).toEqual(['a', 'c'])
  })
})

describe('holdReason', () => {
  it('decodes a firstmate hold and passes any other text through', () => {
    const encoded = `fm-hold-v1:${Buffer.from('Approve the mockup').toString('base64')}`
    expect(holdReason(encoded)).toBe('Approve the mockup')
    expect(holdReason('Held until Monday')).toBe('Held until Monday')
    expect(holdReason(undefined)).toBeUndefined()
  })
})
