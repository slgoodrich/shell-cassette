import { describe, expect, test } from 'vitest'
import { BUNDLED_PATTERNS } from '../../src/redact-patterns.js'

describe('BUNDLED_PATTERNS', () => {
  test('exports exactly 25 rules', () => {
    expect(BUNDLED_PATTERNS.length).toBe(25)
  })

  test('all rule names are unique', () => {
    const names = BUNDLED_PATTERNS.map((r) => r.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  test('all rule names are kebab-case', () => {
    for (const rule of BUNDLED_PATTERNS) {
      expect(rule.name).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  test('all regex patterns have the global flag', () => {
    for (const rule of BUNDLED_PATTERNS) {
      if (rule.pattern instanceof RegExp) {
        expect(rule.pattern.flags).toContain('g')
      }
    }
  })
})

describe('per-rule regression fixtures', () => {
  function findRule(name: string) {
    const rule = BUNDLED_PATTERNS.find((r) => r.name === name)
    if (!rule) throw new Error(`rule not found: ${name}`)
    if (!(rule.pattern instanceof RegExp)) throw new Error(`rule ${name} is not a RegExp`)
    return rule.pattern
  }

  function matches(name: string, input: string): boolean {
    const re = findRule(name)
    return new RegExp(re.source, re.flags).test(input)
  }

  test('github-pat-classic', () => {
    expect(matches('github-pat-classic', 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')).toBe(true)
    expect(matches('github-pat-classic', 'ghp_TooShort')).toBe(false)
    expect(matches('github-pat-classic', 'gha_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')).toBe(false)
  })

  test('github-pat-fine-grained', () => {
    const sample = `github_pat_${'A'.repeat(82)}`
    expect(matches('github-pat-fine-grained', sample)).toBe(true)
    expect(matches('github-pat-fine-grained', 'github_pat_TOOSHORT')).toBe(false)
  })

  test('github-oauth, user-to-server, server-to-server, refresh', () => {
    expect(matches('github-oauth', 'gho_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')).toBe(true)
    expect(matches('github-user-to-server', 'ghu_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')).toBe(true)
    expect(matches('github-server-to-server', 'ghs_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')).toBe(
      true,
    )
    expect(matches('github-refresh', 'ghr_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')).toBe(true)
  })

  test('aws-access-key-id covers all 10 prefix variants', () => {
    const prefixes = [
      'AKIA',
      'ASIA',
      'AROA',
      'AIDA',
      'AGPA',
      'ANPA',
      'ANVA',
      'APKA',
      'ABIA',
      'ACCA',
    ]
    for (const p of prefixes) {
      expect(matches('aws-access-key-id', `${p}0123456789ABCDEF`)).toBe(true)
    }
    expect(matches('aws-access-key-id', 'akia0123456789ABCDEF')).toBe(false)
    expect(matches('aws-access-key-id', 'AKIA0123')).toBe(false)
  })

  test('stripe-secret-live, stripe-secret-test, stripe-restricted-live, stripe-restricted-test', () => {
    expect(matches('stripe-secret-live', `sk_live_${'a'.repeat(24)}`)).toBe(true)
    expect(matches('stripe-secret-test', `sk_test_${'a'.repeat(24)}`)).toBe(true)
    expect(matches('stripe-restricted-live', `rk_live_${'a'.repeat(24)}`)).toBe(true)
    expect(matches('stripe-restricted-test', `rk_test_${'a'.repeat(24)}`)).toBe(true)
    expect(matches('stripe-secret-live', 'sk_live_short')).toBe(false)
  })

  test('openai-api-key with all prefix variants', () => {
    expect(matches('openai-api-key', `sk-${'a'.repeat(48)}`)).toBe(true)
    expect(matches('openai-api-key', `sk-proj-${'a'.repeat(48)}`)).toBe(true)
    expect(matches('openai-api-key', `sk-svcacct-${'a'.repeat(48)}`)).toBe(true)
    expect(matches('openai-api-key', `sk-admin-${'a'.repeat(48)}`)).toBe(true)
    expect(matches('openai-api-key', 'sk-short')).toBe(false)
  })

  test('anthropic-api-key with all prefix variants', () => {
    expect(matches('anthropic-api-key', `sk-ant-api03-${'a'.repeat(80)}`)).toBe(true)
    expect(matches('anthropic-api-key', `sk-ant-sid01-${'a'.repeat(80)}`)).toBe(true)
    expect(matches('anthropic-api-key', `sk-ant-admin01-${'a'.repeat(80)}`)).toBe(true)
    expect(matches('anthropic-api-key', `sk-ant-other-${'a'.repeat(80)}`)).toBe(false)
  })

  test('google-api-key', () => {
    expect(matches('google-api-key', `AIza${'a'.repeat(35)}`)).toBe(true)
    expect(matches('google-api-key', `AIza${'a'.repeat(34)}`)).toBe(false)
    expect(matches('google-api-key', `AIzb${'a'.repeat(35)}`)).toBe(false)
  })

  test('slack-token covers all xox[baprso] prefixes', () => {
    for (const p of ['xoxb', 'xoxa', 'xoxp', 'xoxr', 'xoxs', 'xoxo']) {
      expect(matches('slack-token', `${p}-1234567890`)).toBe(true)
    }
    expect(matches('slack-token', 'xoxz-1234567890')).toBe(false)
  })

  test('slack-webhook-url', () => {
    expect(
      matches(
        'slack-webhook-url',
        'https://hooks.slack.com/services/T0AB12CDE/B0FG34HIJ/0123456789ABCDEF',
      ),
    ).toBe(true)
    expect(matches('slack-webhook-url', 'https://hooks.slack.com/incomplete')).toBe(false)
  })

  test('gitlab-pat', () => {
    expect(matches('gitlab-pat', `glpat-${'a'.repeat(20)}`)).toBe(true)
    expect(matches('gitlab-pat', 'glpat-short')).toBe(false)
  })

  test('npm-token', () => {
    expect(matches('npm-token', `npm_${'a'.repeat(36)}`)).toBe(true)
    expect(matches('npm-token', 'npm_short')).toBe(false)
  })

  test('digitalocean-pat', () => {
    expect(matches('digitalocean-pat', `dop_v1_${'0'.repeat(64)}`)).toBe(true)
    expect(matches('digitalocean-pat', 'dop_v1_short')).toBe(false)
  })

  test('sendgrid-api-key', () => {
    expect(matches('sendgrid-api-key', `SG.${'a'.repeat(22)}.${'a'.repeat(43)}`)).toBe(true)
    expect(matches('sendgrid-api-key', 'SG.short.short')).toBe(false)
  })

  test('mailgun-api-key', () => {
    expect(matches('mailgun-api-key', `key-${'0'.repeat(32)}`)).toBe(true)
    expect(matches('mailgun-api-key', 'key-short')).toBe(false)
  })

  test('huggingface-token', () => {
    expect(matches('huggingface-token', `hf_${'a'.repeat(34)}`)).toBe(true)
    expect(matches('huggingface-token', 'hf_short')).toBe(false)
  })

  test('pypi-token', () => {
    expect(matches('pypi-token', `pypi-AgE${'a'.repeat(50)}`)).toBe(true)
    expect(matches('pypi-token', 'pypi-other')).toBe(false)
  })

  test('discord-bot-token', () => {
    const sample = `M${'a'.repeat(23)}.${'a'.repeat(6)}.${'a'.repeat(27)}`
    expect(matches('discord-bot-token', sample)).toBe(true)
    expect(matches('discord-bot-token', 'M.short.short')).toBe(false)
  })

  test('square-production-token', () => {
    expect(matches('square-production-token', `EAAA${'a'.repeat(60)}`)).toBe(true)
    expect(matches('square-production-token', 'EAAA-short')).toBe(false)
  })
})
