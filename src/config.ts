import { CassetteConfigError } from './errors.js'
import { defaultMatcher } from './matcher.js'
import type { MatcherFn } from './types.js'

export type Config = {
  matcher: MatcherFn
  cassetteDir: string
  redactEnvKeys: string[]
}

export type PartialConfig = Partial<Config>

export const DEFAULT_CONFIG: Readonly<Config> = Object.freeze({
  matcher: defaultMatcher,
  cassetteDir: '__cassettes__',
  redactEnvKeys: [] as string[],
})

export function mergeWithDefaults(input: PartialConfig | undefined): Readonly<Config> {
  return Object.freeze({
    matcher: input?.matcher ?? DEFAULT_CONFIG.matcher,
    cassetteDir: input?.cassetteDir ?? DEFAULT_CONFIG.cassetteDir,
    redactEnvKeys: input?.redactEnvKeys ?? DEFAULT_CONFIG.redactEnvKeys,
  })
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
  if ('matcher' in obj && typeof obj.matcher !== 'function') {
    throw new CassetteConfigError('config.matcher must be a function (call, recording) => boolean')
  }
  if ('redactEnvKeys' in obj) {
    if (!Array.isArray(obj.redactEnvKeys)) {
      throw new CassetteConfigError('config.redactEnvKeys must be an array of strings')
    }
    if (!obj.redactEnvKeys.every((k) => typeof k === 'string')) {
      throw new CassetteConfigError('config.redactEnvKeys items must all be strings')
    }
  }
}

// loadConfig and getConfig defined later in this file (see Task 20)
