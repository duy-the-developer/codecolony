import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG_FILE, ConfigError, loadConfig, parseConfig } from './config.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'codecolony-config-'))
}

describe('loadConfig', () => {
  it('maps its own checkout when there is no config file', () => {
    const repoRoot = join(tempDir(), 'codecolony')
    const config = loadConfig({ env: {}, repoRoot })
    expect(config.source).toBe('default')
    expect(config.projects).toEqual([{ name: 'codecolony', root: repoRoot, kind: 'repo' }])
    expect(config.cacheDir).toBe(join(homedir(), '.cache', 'codecolony'))
  })

  it('reads the config file at the checkout root', () => {
    const repoRoot = tempDir()
    const file = join(repoRoot, CONFIG_FILE)
    writeFileSync(
      file,
      JSON.stringify({ projects: [{ name: 'side', root: '../side', kind: 'monorepo' }] }),
    )
    const config = loadConfig({ env: {}, repoRoot })
    expect(config.source).toBe(file)
    expect(config.projects).toEqual([
      { name: 'side', root: join(repoRoot, '..', 'side'), kind: 'monorepo' },
    ])
  })

  it('prefers the file named by the environment', () => {
    const dir = tempDir()
    const file = join(dir, 'elsewhere.json')
    writeFileSync(
      file,
      JSON.stringify({ projects: [{ name: 'org', root: '~/org', kind: 'repos' }] }),
    )
    const config = loadConfig({ env: { CODECOLONY_CONFIG: file }, repoRoot: tempDir() })
    expect(config.projects[0]?.root).toBe(join(homedir(), 'org'))
  })

  it('fails loudly when the environment names a missing file', () => {
    expect(() =>
      loadConfig({ env: { CODECOLONY_CONFIG: join(tempDir(), 'nope.json') }, repoRoot: tempDir() }),
    ).toThrow(ConfigError)
  })

  it('reports invalid JSON with the file path', () => {
    const repoRoot = tempDir()
    writeFileSync(join(repoRoot, CONFIG_FILE), '{ nope')
    expect(() => loadConfig({ env: {}, repoRoot })).toThrow(/not valid JSON/)
  })
})

describe('parseConfig', () => {
  it('defaults kind to repo and resolves cacheDir', () => {
    const config = parseConfig(
      { projects: [{ name: 'a', root: '/a' }], cacheDir: 'cache' },
      '/base',
    )
    expect(config).toEqual({
      projects: [{ name: 'a', root: '/a', kind: 'repo' }],
      cacheDir: '/base/cache',
    })
  })

  it.each([
    [null, /expected an object/],
    [{ projects: [] }, /non-empty array/],
    [{ projects: [{ name: 'a b', root: '/a' }] }, /\.name/],
    [{ projects: [{ name: 'a', root: '' }] }, /\.root/],
    [{ projects: [{ name: 'a', root: '/a', kind: 'svn' }] }, /\.kind/],
    [
      {
        projects: [
          { name: 'a', root: '/a' },
          { name: 'a', root: '/b' },
        ],
      },
      /duplicate name "a"/,
    ],
    [{ projects: [{ name: 'a', root: '/a' }], cacheDir: 1 }, /cacheDir/],
  ])('rejects %j', (raw, message) => {
    expect(() => parseConfig(raw, '/base')).toThrow(message)
  })
})
