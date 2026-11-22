import { describe, expect, it } from 'vitest'
import { parseStatusLine, parseStatusLog } from './parse-status-log.ts'

const PR = 'https://github.com/acme/app/pull/64'

describe('parseStatusLog', () => {
  it('is working with the latest event as its note', () => {
    const status = parseStatusLog(
      'working [at=1]: setup done\nacked [corr=x] [at=2]: relayed\nworking [at=3]: tests pass\n',
    )
    expect(status).toEqual({ state: 'working', note: 'tests pass' })
  })

  it('waits on you while a decision is open, even after later work', () => {
    const status = parseStatusLog(
      [
        'working [at=1]: started',
        'needs-decision [key=scope] [at=2]: keep A or B?',
        'working [at=3]: meanwhile, writing tests',
      ].join('\n'),
    )
    expect(status).toEqual({ state: 'waiting', note: 'keep A or B?' })
  })

  it('closes a decision with a resolved line of the same key', () => {
    const status = parseStatusLog(
      [
        'needs-decision [key=scope] [at=2]: keep A or B?',
        'resolved [key=other] [at=3]: not this one',
        'blocked [at=4]: daemon socket refused',
        'resolved [key=scope] [at=5]: A',
      ].join('\n'),
    )
    expect(status).toEqual({ state: 'blocked', note: 'daemon socket refused' })
  })

  it('goes back to the latest progress once its open decision or block is resolved', () => {
    expect(
      parseStatusLog(
        [
          'working [at=1]: started',
          'needs-decision [key=scope] [at=2]: A or B?',
          'resolved [key=scope] [at=3]: A',
        ].join('\n'),
      ),
    ).toEqual({ state: 'working', note: 'started' })
    expect(
      parseStatusLog(
        [
          'working [at=1]: started',
          'blocked [key=x] [at=2]: no socket',
          'resolved [key=x] [at=3]: up',
        ].join('\n'),
      ),
    ).toEqual({ state: 'working', note: 'started' })
    expect(parseStatusLog('blocked [at=1]: no socket\nresolved [at=2]: up')).toEqual({
      state: 'working',
    })
  })

  it('is PR ready when done names the PR, and still working on a bare handoff', () => {
    expect(parseStatusLog(`working [at=1]: draft at ${PR}\ndone [at=2]: built it`)).toEqual({
      state: 'working',
      note: 'built it',
      pullRequestUrl: PR,
    })
    expect(parseStatusLog(`done [at=2]: PR ${PR} checks green`)).toMatchObject({
      state: 'pr-ready',
      pullRequestUrl: PR,
    })
  })

  it('treats failed as blocked and an empty log as working', () => {
    expect(parseStatusLog('failed [at=1]: gave up').state).toBe('blocked')
    expect(parseStatusLog('')).toEqual({ state: 'working' })
  })
})

describe('parseStatusLine', () => {
  it('reads the verb, the key and the text', () => {
    expect(parseStatusLine('needs-decision [at=1] [key=nm-2]: pick one: a or b')).toEqual({
      verb: 'needs-decision',
      key: 'nm-2',
      text: 'pick one: a or b',
    })
    expect(parseStatusLine('merged')).toBeUndefined()
  })
})
