import { describe, expect, test } from 'vitest'
import { CURATED_KEYS, redactEnv } from '../../src/redact.js'

const defaultConfig = { redactEnvKeys: [] as string[] }

describe('redactEnv (curated list)', () => {
  test('redacts TOKEN, SECRET, PASSWORD, JWT keys', () => {
    const env = {
      MY_TOKEN: 'abc',
      USER_SECRET: 'def',
      DB_PASSWORD: 'ghi',
      JWT_KEY: 'jkl',
      SAFE_VAR: 'public',
    }
    const result = redactEnv(env, defaultConfig)
    expect(result.redacted.MY_TOKEN).toBe('<redacted>')
    expect(result.redacted.USER_SECRET).toBe('<redacted>')
    expect(result.redacted.DB_PASSWORD).toBe('<redacted>')
    expect(result.redacted.JWT_KEY).toBe('<redacted>')
    expect(result.redacted.SAFE_VAR).toBe('public')
    expect(result.redactedKeys).toEqual(
      expect.arrayContaining(['MY_TOKEN', 'USER_SECRET', 'DB_PASSWORD', 'JWT_KEY']),
    )
  })

  test('case-insensitive substring match', () => {
    const env = { my_token_value: 'abc', SeCrEt: 'def' }
    const result = redactEnv(env, defaultConfig)
    expect(result.redacted.my_token_value).toBe('<redacted>')
    expect(result.redacted.SeCrEt).toBe('<redacted>')
  })

  test('does not redact PUBLIC_KEY (curated has PRIVATE_KEY only)', () => {
    const env = { PUBLIC_KEY: 'pubdata', PRIVATE_KEY: 'privdata' }
    const result = redactEnv(env, defaultConfig)
    expect(result.redacted.PUBLIC_KEY).toBe('pubdata')
    expect(result.redacted.PRIVATE_KEY).toBe('<redacted>')
  })

  test('does not redact bare KEY-suffix names like STRIPE_KEY (documented gap)', () => {
    const env = { STRIPE_KEY: 'sk_live_xyz', OPENAI_KEY: 'sk-abc' }
    const result = redactEnv(env, defaultConfig)
    expect(result.redacted.STRIPE_KEY).toBe('sk_live_xyz')
    expect(result.redacted.OPENAI_KEY).toBe('sk-abc')
  })
})

describe('redactEnv (user-extended via config)', () => {
  test('config.redactEnvKeys adds to curated list', () => {
    const env = { STRIPE_KEY: 'sk_live_xyz', NORMAL: 'safe' }
    const result = redactEnv(env, { redactEnvKeys: ['STRIPE_KEY'] })
    expect(result.redacted.STRIPE_KEY).toBe('<redacted>')
    expect(result.redacted.NORMAL).toBe('safe')
  })

  test('config keys are case-insensitive substring like curated', () => {
    const env = { my_stripe_key: 'sk', X: 'safe' }
    const result = redactEnv(env, { redactEnvKeys: ['STRIPE'] })
    expect(result.redacted.my_stripe_key).toBe('<redacted>')
  })

  test('curated still applies when user adds extras', () => {
    const env = { TOKEN: 'a', STRIPE_KEY: 'b' }
    const result = redactEnv(env, { redactEnvKeys: ['STRIPE'] })
    expect(result.redacted.TOKEN).toBe('<redacted>')
    expect(result.redacted.STRIPE_KEY).toBe('<redacted>')
  })
})

describe('redactEnv (length warnings)', () => {
  test('emits warning for unredacted env value > 100 chars', () => {
    const env = { LONG_VAR: 'a'.repeat(150) }
    const result = redactEnv(env, defaultConfig)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toContain('LONG_VAR')
    expect(result.warnings[0]).toContain('150')
  })

  test('no warning at exactly 100 chars', () => {
    const env = { VAR: 'a'.repeat(100) }
    const result = redactEnv(env, defaultConfig)
    expect(result.warnings.length).toBe(0)
  })

  test('warning at 101 chars', () => {
    const env = { VAR: 'a'.repeat(101) }
    const result = redactEnv(env, defaultConfig)
    expect(result.warnings.length).toBe(1)
  })

  test('no warning for redacted long values', () => {
    const env = { GH_TOKEN: 'a'.repeat(150) }
    const result = redactEnv(env, defaultConfig)
    expect(result.warnings.length).toBe(0)
  })
})

describe('CURATED_KEYS exposed for testing/inspection', () => {
  test('contains expected items', () => {
    const expected = [
      'TOKEN',
      'SECRET',
      'PASSWORD',
      'PASSWD',
      'APIKEY',
      'API_KEY',
      'CREDENTIAL',
      'PRIVATE_KEY',
      'AUTH_TOKEN',
      'BEARER_TOKEN',
      'JWT',
    ]
    for (const key of expected) {
      expect(CURATED_KEYS).toContain(key)
    }
  })
})
