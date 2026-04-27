import { describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG, mergeWithDefaults, validateConfig } from '../../src/config.js'
import { CassetteConfigError } from '../../src/errors.js'

describe('DEFAULT_CONFIG', () => {
  test('has cassetteDir = __cassettes__', () => {
    expect(DEFAULT_CONFIG.cassetteDir).toBe('__cassettes__')
  })

  test('has empty redactEnvKeys', () => {
    expect(DEFAULT_CONFIG.redactEnvKeys).toEqual([])
  })

  test('default canonicalize returns command + args', () => {
    const call = { command: 'git', args: ['status'], cwd: null, env: {}, stdin: null } as const
    expect(DEFAULT_CONFIG.canonicalize(call)).toEqual({ command: 'git', args: ['status'] })
  })
})

describe('mergeWithDefaults', () => {
  test('returns defaults when input is undefined', () => {
    const result = mergeWithDefaults(undefined)
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  test('returns defaults when input is empty', () => {
    const result = mergeWithDefaults({})
    expect(result.cassetteDir).toBe(DEFAULT_CONFIG.cassetteDir)
  })

  test('overrides cassetteDir', () => {
    const result = mergeWithDefaults({ cassetteDir: 'cassettes' })
    expect(result.cassetteDir).toBe('cassettes')
  })

  test('overrides redactEnvKeys', () => {
    const result = mergeWithDefaults({ redactEnvKeys: ['STRIPE_KEY'] })
    expect(result.redactEnvKeys).toEqual(['STRIPE_KEY'])
  })

  test('result is frozen', () => {
    const result = mergeWithDefaults({})
    expect(Object.isFrozen(result)).toBe(true)
  })
})

describe('validateConfig', () => {
  test('passes for empty input', () => {
    expect(() => validateConfig({})).not.toThrow()
  })

  test('throws CassetteConfigError on non-object', () => {
    expect(() => validateConfig(null)).toThrow(CassetteConfigError)
    expect(() => validateConfig('string')).toThrow(CassetteConfigError)
    expect(() => validateConfig(42)).toThrow(CassetteConfigError)
  })

  test('throws if cassetteDir is not string', () => {
    expect(() => validateConfig({ cassetteDir: 42 })).toThrow(CassetteConfigError)
  })

  test('throws if redactEnvKeys is not array of strings', () => {
    expect(() => validateConfig({ redactEnvKeys: 'foo' })).toThrow(CassetteConfigError)
    expect(() => validateConfig({ redactEnvKeys: [1, 2] })).toThrow(CassetteConfigError)
  })

  test('throws if canonicalize is not function', () => {
    expect(() => validateConfig({ canonicalize: 'foo' })).toThrow(CassetteConfigError)
  })
})
