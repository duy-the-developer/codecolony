import { describe, expect, it } from 'vitest'
import { parseStatusLog } from '../build-queue/load-build-queue.ts'
import { copyLabel, resolvePresence, tildify } from './colonist-status.ts'

describe('resolvePresence', () => {
  const taskWith = (...lines: string[]) => ({ id: 't', status: parseStatusLog(lines.join('\n')) })
  const task = taskWith('working [at=1]: adding the map layer')
  const prUrl = 'https://github.com/o/r/pull/7'

  it('is idle with no live session in the copy', () => {
    expect(resolvePresence(task, [], true)).toEqual({
      status: 'idle',
      session: 'none',
      note: 'adding the map layer',
    })
  })

  it.each([
    [`done [at=1]: PR ${prUrl} checks green`, 'pr-ready'],
    ['blocked [at=1]: stopped', 'blocked'],
    ['failed [at=1]: stopped', 'error'],
    ['needs-decision [key=a] [at=1]: stopped', 'waiting'],
  ] as const)('keeps a task that ended with %s as %s with no live session', (line, expected) => {
    expect(resolvePresence(taskWith(line), [], true).status).toBe(expected)
  })

  it('is idle for a task that finished without a pull request and no live session', () => {
    expect(resolvePresence(taskWith('done [at=1]: merged by hand'), [], true).status).toBe('idle')
  })

  it('waits on you while a decision is open, as the build queue card does', () => {
    const open = taskWith('needs-decision [key=a] [at=1]: pick X', 'working [at=2]: continuing')
    const live = [{ cwd: '/c', status: 'working' as const }]
    expect(resolvePresence(open, live, true)).toMatchObject({ status: 'waiting', note: 'pick X' })
    expect(resolvePresence(open, [], true).status).toBe('waiting')
    const answered = taskWith(
      'needs-decision [key=a] [at=1]: pick X',
      'resolved [key=a] [at=2]: X',
      'working [at=3]: continuing',
    )
    expect(resolvePresence(answered, live, true).status).toBe('working')
  })

  it('takes the pull request from any status line', () => {
    const drafted = taskWith(`working [at=1]: draft at ${prUrl}`, 'working [at=2]: fixing review')
    expect(resolvePresence(drafted, [{ cwd: '/c' }], true)).toMatchObject({
      status: 'working',
      pr: prUrl,
    })
  })

  it('trusts a firstmate task when no session source answered', () => {
    expect(resolvePresence(task, [], false)).toMatchObject({
      status: 'working',
      session: 'firstmate',
    })
  })

  it('takes the status from firstmate, and waiting from Herdr', () => {
    const working = [{ cwd: '/c', status: 'working' as const, paneId: 'w1:p1', agent: 'claude' }]
    expect(resolvePresence(task, working, true)).toEqual({
      status: 'working',
      session: 'firstmate',
      note: 'adding the map layer',
      agent: 'claude',
      paneId: 'w1:p1',
    })
    const waiting = [{ cwd: '/c', status: 'waiting' as const }]
    expect(resolvePresence(task, waiting, true).status).toBe('waiting')
  })

  it('counts your own session as working when nothing says otherwise', () => {
    expect(resolvePresence(undefined, [{ cwd: '/c', agent: 'claude' }], true)).toEqual({
      status: 'working',
      session: 'own',
      agent: 'claude',
    })
  })
})

describe('copyLabel', () => {
  it('names a copy by its folder and branch, or a pool slot by its number', () => {
    expect(copyLabel('/Users/me/p/codecolony', 'production')).toBe('p/codecolony · production')
    expect(copyLabel('/Users/me/.treehouse/codecolony-d64159/5/codecolony', undefined)).toBe(
      'codecolony-d64159/5 · detached',
    )
  })
})

describe('tildify', () => {
  it('shortens paths under the home folder', () => {
    expect(tildify('/Users/me/p/x', '/Users/me')).toBe('~/p/x')
    expect(tildify('/Users/meow/x', '/Users/me')).toBe('/Users/meow/x')
  })
})
