import { describe, expect, test } from 'vitest'
import { BUNDLED_PATTERNS, redact } from '../../src/redact.js'
import type { RedactConfig } from '../../src/types.js'
import { SAMPLE_GITHUB_PAT_CLASSIC } from '../helpers/credential-fixtures.js'

const baseConfig: RedactConfig = {
  bundledPatterns: false,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
  suppressLengthWarningKeys: [],
}

describe('public redact() wraps pipeline', () => {
  test('bundledPatterns: false — input unchanged for credential-shaped value', () => {
    const r = redact({ source: 'env', value: SAMPLE_GITHUB_PAT_CLASSIC }, baseConfig, {
      counted: false,
    })
    expect(r.output).toBe(SAMPLE_GITHUB_PAT_CLASSIC)
    expect(r.entries).toEqual([])
    expect(r.warnings).toEqual([])
  })

  test('counted: false — emits placeholder without counter', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const r = redact({ source: 'env', value: SAMPLE_GITHUB_PAT_CLASSIC }, config, {
      counted: false,
    })
    expect(r.output).toBe('<redacted:env:github-pat-classic>')
  })

  test('counted: true — increments counter and returns counted placeholder', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const counters = new Map<string, number>()
    const r = redact({ source: 'env', value: SAMPLE_GITHUB_PAT_CLASSIC }, config, {
      counted: true,
      counters,
    })
    expect(r.output).toBe('<redacted:env:github-pat-classic:1>')
    expect(counters.get('env:github-pat-classic')).toBe(1)
  })

  test('BUNDLED_PATTERNS exports 25 rules with stable names', () => {
    expect(BUNDLED_PATTERNS.length).toBe(25)
    const names = BUNDLED_PATTERNS.map((r) => r.name)
    expect(names).toContain('github-pat-classic')
    expect(names).toContain('aws-access-key-id')
    expect(names).toContain('openai-api-key')
  })
})
