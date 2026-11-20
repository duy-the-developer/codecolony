import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { PROJECT_KINDS, type ProjectKind, type ProjectSummary } from '../shared/api.ts'

// Project roots are read at runtime from a local, gitignored file so that no
// path, name or rule for a private codebase ever lands in this repository.

export const CONFIG_ENV = 'CODECOLONY_CONFIG'
export const CONFIG_FILE = 'codecolony.config.json'

export interface ProjectConfig extends ProjectSummary {
  root: string
}

export interface ColonyConfig {
  projects: ProjectConfig[]
  cacheDir: string
  // Where the config came from: a file path, or 'default'.
  source: string
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv
  // The checkout this app lives in: holds the default config file and is the
  // default project when there is no config.
  repoRoot: string
}

export function loadConfig({ env = process.env, repoRoot }: LoadConfigOptions): ColonyConfig {
  const fromEnv = env[CONFIG_ENV]
  const file = fromEnv ? resolve(expandHome(fromEnv)) : join(repoRoot, CONFIG_FILE)
  if (!existsSync(file)) {
    if (fromEnv) throw new ConfigError(`${CONFIG_ENV} points at a missing file: ${file}`)
    return {
      projects: [{ name: basename(repoRoot), root: repoRoot, kind: 'repo' }],
      cacheDir: defaultCacheDir(),
      source: 'default',
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ConfigError(`${file}: not valid JSON (${(error as Error).message})`)
  }
  return { ...parseConfig(raw, dirname(file)), source: file }
}

// Relative roots and cacheDir resolve against the config file's folder.
export function parseConfig(raw: unknown, baseDir: string): Omit<ColonyConfig, 'source'> {
  if (!isRecord(raw)) throw new ConfigError('config: expected an object')
  const { projects, cacheDir } = raw
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new ConfigError('config.projects: expected a non-empty array')
  }
  const parsed = projects.map((project, i) =>
    parseProject(project, `config.projects[${i}]`, baseDir),
  )
  const names = new Set<string>()
  for (const { name } of parsed) {
    if (names.has(name)) throw new ConfigError(`config.projects: duplicate name "${name}"`)
    names.add(name)
  }
  if (cacheDir !== undefined && typeof cacheDir !== 'string') {
    throw new ConfigError('config.cacheDir: expected a string')
  }
  return {
    projects: parsed,
    cacheDir: cacheDir ? resolvePath(cacheDir, baseDir) : defaultCacheDir(),
  }
}

function parseProject(raw: unknown, at: string, baseDir: string): ProjectConfig {
  if (!isRecord(raw)) throw new ConfigError(`${at}: expected an object`)
  const { name, root, kind = 'repo' } = raw
  if (typeof name !== 'string' || !/^[\w.-]+$/.test(name)) {
    throw new ConfigError(`${at}.name: expected letters, digits, ".", "_" or "-"`)
  }
  if (typeof root !== 'string' || root === '') {
    throw new ConfigError(`${at}.root: expected a path`)
  }
  if (!isProjectKind(kind)) {
    throw new ConfigError(`${at}.kind: expected one of ${PROJECT_KINDS.join(', ')}`)
  }
  return { name, root: resolvePath(root, baseDir), kind }
}

function isProjectKind(value: unknown): value is ProjectKind {
  return PROJECT_KINDS.some((kind) => kind === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

function resolvePath(path: string, baseDir: string): string {
  const expanded = expandHome(path)
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)
}

function defaultCacheDir(): string {
  return join(homedir(), '.cache', 'codecolony')
}
