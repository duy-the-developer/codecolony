import { describe, expect, it } from 'vitest'
import { copyLabel, resolvePresence, statusFromTask, tildify } from './colonist-status.ts'

describe('statusFromTask', () => {
  it.each([
    ['working', undefined, 'working'],
    ['progress', undefined, 'working'],
    ['paused', undefined, 'paused'],
    ['needs-decision', undefined, 'waiting'],
    ['blocked', undefined, 'blocked'],
    ['failed', undefined, 'error'],
    ['done', 'https://github.com/o/r/pull/7', 'pr-ready'],
    ['done', undefined, 'paused'],
  ] as const)('reads %s as %s', (state, pr, expected) => {
    const task = { id: 't', status: { state, text: '' }, ...(pr ? { pr } : {}) }
    expect(statusFromTask(task)).toBe(expected)
  })
})

describe('resolvePresence', () => {
  const task = { id: 't', status: { state: 'working', text: 'adding the map layer' } }

  it('is idle with no live session in the copy', () => {
    expect(resolvePresence(task, [], true)).toEqual({
      status: 'idle',
      session: 'none',
      note: 'adding the map layer',
    })
  })

  it.each([
    ['done', 'https://github.com/o/r/pull/7', 'pr-ready'],
    ['blocked', undefined, 'blocked'],
    ['failed', undefined, 'error'],
    ['needs-decision', undefined, 'waiting'],
  ] as const)('keeps a task that ended %s as %s with no live session', (state, pr, expected) => {
    const ended = { id: 't', status: { state, text: 'stopped' }, ...(pr ? { pr } : {}) }
    expect(resolvePresence(ended, [], true)).toEqual({
      status: expected,
      session: 'none',
      note: 'stopped',
      ...(pr ? { pr } : {}),
    })
  })

  it('is idle for a task that finished without a pull request and no live session', () => {
    const done = { id: 't', status: { state: 'done', text: 'merged by hand' } }
    expect(resolvePresence(done, [], true).status).toBe('idle')
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
