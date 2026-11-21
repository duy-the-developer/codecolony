import { describe, expect, it } from 'vitest'
import { clientEnv, DockOptionsError, resolveDockOptions } from './options.ts'

const env = { HOME: '/home/me' }

describe('resolveDockOptions', () => {
  it('attaches to the default session by default', () => {
    expect(resolveDockOptions({}, env)).toEqual({
      enabled: true,
      session: null,
      socketPath: '/home/me/.config/herdr/herdr.sock',
      client: { file: 'herdr', args: [] },
      cwd: '/home/me',
      lab: false,
    })
  })

  it('attaches to a named session', () => {
    const options = resolveDockOptions({ 'herdr-session': 'work' }, env)
    expect(options.client.args).toEqual(['--session', 'work'])
    expect(options.socketPath).toBe('/home/me/.config/herdr/sessions/work/herdr.sock')
  })

  it('follows XDG_CONFIG_HOME', () => {
    const options = resolveDockOptions({}, { ...env, XDG_CONFIG_HOME: '/xdg' })
    expect(options.socketPath).toBe('/xdg/herdr/herdr.sock')
  })

  it('reads the environment when there are no flags', () => {
    const options = resolveDockOptions(
      {},
      { ...env, CODECOLONY_HERDR_SESSION: 'work', CODECOLONY_HERDR_BIN: '/opt/herdr' },
    )
    expect(options.client).toEqual({ file: '/opt/herdr', args: ['--session', 'work'] })
  })

  it('takes an explicit socket', () => {
    expect(resolveDockOptions({ 'herdr-socket': '/tmp/h.sock' }, env).socketPath).toBe(
      '/tmp/h.sock',
    )
  })

  it.each(['../etc', 'a/b', '-x', ''])('rejects the session name %j', (name) => {
    expect(() => resolveDockOptions({ 'herdr-session': name }, env)).toThrow(DockOptionsError)
    expect(() => resolveDockOptions({ 'herdr-session': name }, env)).toThrow(
      expect.objectContaining({ code: 'InvalidSession' }),
    )
  })

  it('rejects a relative socket', () => {
    expect(() => resolveDockOptions({ 'herdr-socket': 'h.sock' }, env)).toThrow(/absolute/)
    expect(() => resolveDockOptions({ 'herdr-socket': 'h.sock' }, env)).toThrow(
      expect.objectContaining({ code: 'RelativeSocket' }),
    )
  })

  describe('switching Herdr off', () => {
    it('turns Herdr off with --no-herdr', () => {
      expect(resolveDockOptions({ 'no-herdr': true }, env).enabled).toBe(false)
    })

    it('turns Herdr off with CODECOLONY_HERDR=off', () => {
      expect(resolveDockOptions({}, { ...env, CODECOLONY_HERDR: 'off' }).enabled).toBe(false)
    })

    it.each(['true', '1', 'woodpecker'])('turns Herdr off when CI is %j', (ci) => {
      expect(resolveDockOptions({}, { ...env, CI: ci }).enabled).toBe(false)
    })

    it.each(['', 'false', '0'])('keeps Herdr on when CI is %j', (ci) => {
      expect(resolveDockOptions({}, { ...env, CI: ci }).enabled).toBe(true)
    })

    it('lets CODECOLONY_HERDR=on turn Herdr back on under CI', () => {
      expect(resolveDockOptions({}, { ...env, CI: 'true', CODECOLONY_HERDR: 'on' }).enabled).toBe(
        true,
      )
    })

    it('lets --no-herdr win over CODECOLONY_HERDR=on', () => {
      expect(
        resolveDockOptions({ 'no-herdr': true }, { ...env, CODECOLONY_HERDR: 'on' }).enabled,
      ).toBe(false)
    })

    it('rejects any other CODECOLONY_HERDR value', () => {
      expect(() => resolveDockOptions({}, { ...env, CODECOLONY_HERDR: 'no' })).toThrow(
        expect.objectContaining({ code: 'InvalidHerdrSwitch' }),
      )
    })
  })

  describe('lab mode', () => {
    it('allows fm-lab-* sessions', () => {
      const options = resolveDockOptions(
        { 'herdr-lab': true, 'herdr-session': 'fm-lab-dock-1' },
        env,
      )
      expect(options.lab).toBe(true)
      expect(options.client.args).toEqual(['--session', 'fm-lab-dock-1'])
    })

    it.each([undefined, 'default', 'work', 'fm-lab-'])('refuses the session %j', (session) => {
      expect(() =>
        resolveDockOptions({ 'herdr-lab': true, 'herdr-session': session }, env),
      ).toThrow(/fm-lab-/)
      expect(() =>
        resolveDockOptions({ 'herdr-lab': true, 'herdr-session': session }, env),
      ).toThrow(expect.objectContaining({ code: 'LabSessionRefused' }))
    })

    it('can be switched on from the environment', () => {
      expect(() => resolveDockOptions({}, { ...env, CODECOLONY_HERDR_LAB: '1' })).toThrow(
        DockOptionsError,
      )
    })

    it('refuses an explicit socket', () => {
      expect(() =>
        resolveDockOptions(
          { 'herdr-lab': true, 'herdr-session': 'fm-lab-a', 'herdr-socket': '/x.sock' },
          env,
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'LabSocketConflict',
          message: expect.stringMatching(/socket/),
        }),
      )
    })
  })
})

describe('clientEnv', () => {
  it('drops the HERDR_* variables a pane inherits', () => {
    const clean = clientEnv({
      PATH: '/bin',
      HERDR_SOCKET_PATH: '/live.sock',
      HERDR_PANE_ID: 'w1:p1',
      HERDR_SESSION: 'live',
    })
    expect(clean).toEqual({ PATH: '/bin', TERM: 'xterm-256color', COLORTERM: 'truecolor' })
  })
})
