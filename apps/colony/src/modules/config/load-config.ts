import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { PROJECT_KINDS, type ProjectKind, type ProjectSummary } from '../wire/api-types.ts'

// Project roots are read at runtime from a local, gitignored file so that no
// path, name or rule for a private codebase ever lands in this repository.

export const CONFIG_ENV = 'CODECOLONY_CONFIG'
export const CONFIG_FILE = 'codecolony.config.json'
export const PORT_ENV = 'PORT'
export const DEFAULT_PORT = 4320

export interface ProjectConfig extends ProjectSummary {
  root: string
}

export interface ColonyConfig {
  projects: ProjectConfig[]
  cacheDir: string
  // A firstmate home whose backlog and worker state feed the build queue,
  // read only. Absent: the queue is not connected.
  firstmateHome?: string
  // Where the config came from: a file path, or 'default'.
  source: string
  // The server's port, from PORT.
  port: number
}

export type ConfigErrorCode = 'MissingFile' | 'BadJson' | 'InvalidConfig'

export class ConfigError extends Error {
  override name = 'ConfigError'
  readonly code: ConfigErrorCode
  constructor(code: ConfigErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv
  // The checkout this app lives in: holds the default config file and is the
  // default project when there is no config.
  repoRoot: string
}

export function loadConfig({ env = process.env, repoRoot }: LoadConfigOptions): ColonyConfig {
  const port = Number(env[PORT_ENV] ?? DEFAULT_PORT)
  const fromEnv = env[CONFIG_ENV]
  const file = fromEnv ? resolve(expandHome(fromEnv)) : join(repoRoot, CONFIG_FILE)
  if (!existsSync(file)) {
    if (fromEnv) {
      throw new ConfigError('MissingFile', `${CONFIG_ENV} points at a missing file: ${file}`)
    }
    return {
      projects: [{ name: basename(repoRoot), root: repoRoot, kind: 'repo' }],
      cacheDir: defaultCacheDir(),
      source: 'default',
      port,
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ConfigError('BadJson', `${file}: not valid JSON (${(error as Error).message})`, {
      cause: error,
    })
  }
  return { ...parseConfig(raw, dirname(file)), source: file, port }
}

// Relative roots, cacheDir and firstmateHome resolve against the config file's folder.
export function parseConfig(raw: unknown, baseDir: string): Omit<ColonyConfig, 'source' | 'port'> {
  if (!isRecord(raw)) throw new ConfigError('InvalidConfig', 'config: expected an object')
  const { projects, cacheDir, firstmateHome } = raw
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new ConfigError('InvalidConfig', 'config.projects: expected a non-empty array')
  }
  const parsed = projects.map((project, i) =>
    parseProject(project, `config.projects[${i}]`, baseDir),
  )
  const names = new Set<string>()
  for (const { name } of parsed) {
    if (names.has(name))
      throw new ConfigError('InvalidConfig', `config.projects: duplicate name "${name}"`)
    names.add(name)
  }
  if (cacheDir !== undefined && typeof cacheDir !== 'string') {
    throw new ConfigError('InvalidConfig', 'config.cacheDir: expected a string')
  }
  if (firstmateHome !== undefined && (typeof firstmateHome !== 'string' || firstmateHome === '')) {
    throw new ConfigError('InvalidConfig', 'config.firstmateHome: expected a path')
  }
  return {
    projects: parsed,
    cacheDir: cacheDir ? resolvePath(cacheDir, baseDir) : defaultCacheDir(),
    ...(firstmateHome ? { firstmateHome: resolvePath(firstmateHome, baseDir) } : {}),
  }
}

function parseProject(raw: unknown, at: string, baseDir: string): ProjectConfig {
  if (!isRecord(raw)) throw new ConfigError('InvalidConfig', `${at}: expected an object`)
  const { name, root, kind = 'repo' } = raw
  if (typeof name !== 'string' || !/^[\w.-]+$/.test(name)) {
    throw new ConfigError('InvalidConfig', `${at}.name: expected letters, digits, ".", "_" or "-"`)
  }
  if (typeof root !== 'string' || root === '') {
    throw new ConfigError('InvalidConfig', `${at}.root: expected a path`)
  }
  if (!isProjectKind(kind)) {
    throw new ConfigError(
      'InvalidConfig',
      `${at}.kind: expected one of ${PROJECT_KINDS.join(', ')}`,
    )
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
