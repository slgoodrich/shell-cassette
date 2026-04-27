import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CassetteConfigError } from './errors.js'
import { defaultCanonicalize } from './matcher.js'
import type { Canonicalize, RedactConfig, RedactRule } from './types.js'

export type Config = {
  canonicalize: Canonicalize
  cassetteDir: string
  /**
   * @deprecated Use Config.redact.envKeys. This field is kept for v0.3
   * backward compatibility through v0.4 and will be removed in v0.5
   * (when v0.4 M6 ships and the recorder/redact.ts rewrite no longer needs it).
   * mergeWithDefaults populates both this field and Config.redact.envKeys with
   * the same value so existing callers keep working.
   */
  redactEnvKeys: string[]
  /**
   * v0.4 composed redaction config. Bundled patterns, custom rules, suppress
   * list, env-key extension, length warning tuning. See RedactConfig in
   * src/types.ts for field-level docs.
   */
  redact: RedactConfig
}

export type PartialConfig = {
  canonicalize?: Canonicalize
  cassetteDir?: string
  redactEnvKeys?: string[]
  redact?: Partial<RedactConfig>
}

// `Object.freeze([])` returns `readonly []` (TS narrows the empty literal).
// Cast widens to the typed read-only arrays expected by RedactConfig fields.
const DEFAULT_REDACT: Readonly<RedactConfig> = Object.freeze({
  bundledPatterns: true,
  customPatterns: Object.freeze([]) as readonly RedactRule[],
  suppressPatterns: Object.freeze([]) as readonly RegExp[],
  envKeys: Object.freeze([]) as readonly string[],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
})

export const DEFAULT_CONFIG: Readonly<Config> = Object.freeze({
  canonicalize: defaultCanonicalize,
  cassetteDir: '__cassettes__',
  redactEnvKeys: [] as string[],
  redact: DEFAULT_REDACT,
})

export function mergeWithDefaults(input: PartialConfig | undefined): Readonly<Config> {
  const userRedact: Partial<RedactConfig> = input?.redact ?? {}
  const userRedactEnvKeys = input?.redactEnvKeys

  // Resolve envKeys: redact.envKeys takes precedence over deprecated redactEnvKeys.
  // Both Config.redactEnvKeys and Config.redact.envKeys end up with the same value
  // so deprecated and new callers see consistent data.
  const resolvedEnvKeys = userRedact.envKeys ?? userRedactEnvKeys ?? DEFAULT_REDACT.envKeys

  const resolvedRedact: RedactConfig = {
    bundledPatterns: userRedact.bundledPatterns ?? DEFAULT_REDACT.bundledPatterns,
    customPatterns: userRedact.customPatterns
      ? Object.freeze([...userRedact.customPatterns])
      : DEFAULT_REDACT.customPatterns,
    suppressPatterns: userRedact.suppressPatterns
      ? Object.freeze([...userRedact.suppressPatterns])
      : DEFAULT_REDACT.suppressPatterns,
    envKeys: Object.freeze([...resolvedEnvKeys]),
    warnLengthThreshold: userRedact.warnLengthThreshold ?? DEFAULT_REDACT.warnLengthThreshold,
    warnPathHeuristic: userRedact.warnPathHeuristic ?? DEFAULT_REDACT.warnPathHeuristic,
  }

  return Object.freeze({
    canonicalize: input?.canonicalize ?? DEFAULT_CONFIG.canonicalize,
    cassetteDir: input?.cassetteDir ?? DEFAULT_CONFIG.cassetteDir,
    redactEnvKeys: [...resolvedEnvKeys],
    redact: Object.freeze(resolvedRedact),
  })
}

function validateRule(rule: unknown, fieldPath: string, seenNames: Set<string>): void {
  if (typeof rule !== 'object' || rule === null) {
    throw new CassetteConfigError(`${fieldPath} must be an object`)
  }
  const r = rule as Record<string, unknown>

  if (typeof r.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(r.name)) {
    throw new CassetteConfigError(`${fieldPath}.name must be a kebab-case string`)
  }
  if (seenNames.has(r.name)) {
    throw new CassetteConfigError(`${fieldPath}.name '${r.name}' is duplicated`)
  }
  seenNames.add(r.name)

  if (!(r.pattern instanceof RegExp) && typeof r.pattern !== 'function') {
    throw new CassetteConfigError(`${fieldPath}.pattern must be a RegExp or function`)
  }

  if (r.description !== undefined && typeof r.description !== 'string') {
    throw new CassetteConfigError(`${fieldPath}.description must be a string when provided`)
  }
}

function validateRedact(redact: unknown): void {
  if (typeof redact !== 'object' || redact === null) {
    throw new CassetteConfigError('config.redact must be an object')
  }
  const r = redact as Record<string, unknown>

  if (r.bundledPatterns !== undefined && typeof r.bundledPatterns !== 'boolean') {
    throw new CassetteConfigError('config.redact.bundledPatterns must be boolean')
  }

  if (r.customPatterns !== undefined) {
    if (!Array.isArray(r.customPatterns)) {
      throw new CassetteConfigError('config.redact.customPatterns must be an array')
    }
    const seenNames = new Set<string>()
    r.customPatterns.forEach((rule, i) => {
      validateRule(rule, `config.redact.customPatterns[${i}]`, seenNames)
    })
  }

  if (r.suppressPatterns !== undefined) {
    if (!Array.isArray(r.suppressPatterns)) {
      throw new CassetteConfigError('config.redact.suppressPatterns must be an array')
    }
    r.suppressPatterns.forEach((p, i) => {
      if (!(p instanceof RegExp)) {
        throw new CassetteConfigError(`config.redact.suppressPatterns[${i}] must be a RegExp`)
      }
    })
  }

  if (r.envKeys !== undefined) {
    if (!Array.isArray(r.envKeys)) {
      throw new CassetteConfigError('config.redact.envKeys must be an array')
    }
    if (!r.envKeys.every((k) => typeof k === 'string')) {
      throw new CassetteConfigError('config.redact.envKeys items must all be strings')
    }
  }

  if (r.warnLengthThreshold !== undefined) {
    if (
      typeof r.warnLengthThreshold !== 'number' ||
      !Number.isInteger(r.warnLengthThreshold) ||
      r.warnLengthThreshold < 1
    ) {
      throw new CassetteConfigError('config.redact.warnLengthThreshold must be a positive integer')
    }
  }

  if (r.warnPathHeuristic !== undefined && typeof r.warnPathHeuristic !== 'boolean') {
    throw new CassetteConfigError('config.redact.warnPathHeuristic must be boolean')
  }
}

export function validateConfig(input: unknown): asserts input is PartialConfig {
  if (input === undefined) return
  if (input === null || typeof input !== 'object') {
    throw new CassetteConfigError('config must be an object')
  }
  const obj = input as Record<string, unknown>

  if ('cassetteDir' in obj && typeof obj.cassetteDir !== 'string') {
    throw new CassetteConfigError('config.cassetteDir must be a string')
  }
  if ('canonicalize' in obj && typeof obj.canonicalize !== 'function') {
    throw new CassetteConfigError('config.canonicalize must be a function (call) => Partial<Call>')
  }
  if ('redactEnvKeys' in obj) {
    if (!Array.isArray(obj.redactEnvKeys)) {
      throw new CassetteConfigError('config.redactEnvKeys must be an array of strings')
    }
    if (!obj.redactEnvKeys.every((k) => typeof k === 'string')) {
      throw new CassetteConfigError('config.redactEnvKeys items must all be strings')
    }
  }
  if ('redact' in obj) {
    validateRedact(obj.redact)
  }
}

const CONFIG_FILENAMES = ['shell-cassette.config.js', 'shell-cassette.config.mjs']

async function findConfigFile(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir)
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(current, name)
      try {
        await stat(candidate)
        return candidate
      } catch {
        // not found; continue
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export async function loadConfigFromDir(startDir: string): Promise<Readonly<Config>> {
  const filePath = await findConfigFile(startDir)
  if (filePath === null) return DEFAULT_CONFIG

  let imported: { default?: unknown } | unknown
  try {
    imported = await import(pathToFileURL(filePath).href)
  } catch (e) {
    throw new CassetteConfigError(`failed to load config at ${filePath}: ${(e as Error).message}`)
  }

  const exported = (imported as { default?: unknown }).default ?? imported
  validateConfig(exported)
  return mergeWithDefaults(exported as PartialConfig)
}

// Top-level await: loaded once at module init
const _cachedConfig = await loadConfigFromDir(process.cwd())

export function getConfig(): Readonly<Config> {
  return _cachedConfig
}
