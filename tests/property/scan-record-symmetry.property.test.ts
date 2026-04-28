/**
 * Property test: scan vs record symmetry.
 *
 * The load-bearing security guarantee: if record mode would have redacted a
 * value, scan must report that value as a finding. These tests verify the
 * forward direction of that guarantee for every bundled rule and for the
 * env-key-match path.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { scanOne } from '../../src/cli-scan.js'
import { writeCassetteFile } from '../../src/io.js'
import { BUNDLED_PATTERNS } from '../../src/redact.js'
import { ENV_KEY_MATCH_RULE } from '../../src/redact-pipeline.js'
import { serialize } from '../../src/serialize.js'
import type { CassetteFile, RedactConfig, RedactSource } from '../../src/types.js'

const baseConfig: RedactConfig = {
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'sc-symmetry-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

/**
 * Build a minimal v2 cassette with one recording containing `value` at the
 * given source location.
 */
function buildCassette(source: RedactSource, value: string): CassetteFile {
  const recording = {
    call: {
      command: 'echo',
      args: source === 'args' ? [value] : [],
      cwd: null,
      env: source === 'env' ? { SOME_KEY: value } : {},
      stdin: null,
    },
    result: {
      stdoutLines: source === 'stdout' ? [value] : [],
      stderrLines: source === 'stderr' ? [value] : [],
      allLines: source === 'allLines' ? [value] : null,
      exitCode: 0,
      signal: null,
      durationMs: 10,
      aborted: false,
    },
    redactions: [],
  }
  return { version: 2, recordedBy: null, recordings: [recording] }
}

/**
 * Known-valid sample per bundled rule, derived from the per-rule regression
 * fixtures in tests/unit/redact-patterns.test.ts. One sample per rule is
 * sufficient for the forward-symmetry property (the pattern either fires or
 * it doesn't; we are not fuzzing the pattern itself here).
 */
const RULE_SAMPLES: Record<string, string> = {
  'github-pat-classic': 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
  'github-pat-fine-grained': `github_pat_${'A'.repeat(82)}`,
  'github-oauth': `gho_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`,
  'github-user-to-server': `ghu_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`,
  'github-server-to-server': `ghs_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`,
  'github-refresh': `ghr_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`,
  'aws-access-key-id': 'AKIA0123456789ABCDEF',
  'stripe-secret-live': `sk_live_${'a'.repeat(24)}`,
  'stripe-secret-test': `sk_test_${'a'.repeat(24)}`,
  'stripe-restricted-live': `rk_live_${'a'.repeat(24)}`,
  'stripe-restricted-test': `rk_test_${'a'.repeat(24)}`,
  'anthropic-api-key': `sk-ant-api03-${'a'.repeat(80)}`,
  'openai-api-key': `sk-${'a'.repeat(48)}`,
  'google-api-key': `AIza${'a'.repeat(35)}`,
  'slack-token': `xoxb-1234567890`,
  'slack-webhook-url': 'https://hooks.slack.com/services/T0AB12CDE/B0FG34HIJ/0123456789ABCDEF',
  'gitlab-pat': `glpat-${'a'.repeat(20)}`,
  'npm-token': `npm_${'a'.repeat(36)}`,
  'digitalocean-pat': `dop_v1_${'0'.repeat(64)}`,
  'sendgrid-api-key': `SG.${'a'.repeat(22)}.${'a'.repeat(43)}`,
  'mailgun-api-key': `key-${'0'.repeat(32)}`,
  'huggingface-token': `hf_${'a'.repeat(34)}`,
  'pypi-token': `pypi-AgE${'a'.repeat(50)}`,
  'discord-bot-token': `M${'a'.repeat(23)}.${'a'.repeat(6)}.${'a'.repeat(27)}`,
  'square-production-token': `EAAA${'a'.repeat(60)}`,
}

describe('per-rule forward symmetry: redact fires implies scan finds', () => {
  test('all 25 bundled patterns: placing credential in args yields a scan finding with matching rule name', async () => {
    for (const rule of BUNDLED_PATTERNS) {
      const sample = RULE_SAMPLES[rule.name]
      expect(sample, `missing sample for rule: ${rule.name}`).toBeDefined()

      const cassettePath = path.join(tmp, `rule-${rule.name}.json`)
      const cassette = buildCassette('args', sample)
      await writeCassetteFile(cassettePath, serialize(cassette))

      const result = await scanOne(cassettePath, baseConfig, false)

      expect(result.status, `rule ${rule.name}: expected dirty`).toBe('dirty')
      const finding = result.findings?.find((f) => f.rule === rule.name)
      expect(
        finding,
        `rule ${rule.name}: no finding with matching rule name. findings: ${JSON.stringify(result.findings)}`,
      ).toBeDefined()
      expect(finding?.source).toBe('args')
    }
  })
})

describe('per-source coverage: github-pat-classic across all 5 sources', () => {
  const PAT = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
  const SOURCES: RedactSource[] = ['args', 'stdout', 'stderr', 'allLines']

  for (const source of SOURCES) {
    test(`github-pat-classic at source=${source} is reported by scan`, async () => {
      const cassettePath = path.join(tmp, `source-${source}.json`)
      const cassette = buildCassette(source, PAT)
      await writeCassetteFile(cassettePath, serialize(cassette))

      const result = await scanOne(cassettePath, baseConfig, false)

      expect(result.status).toBe('dirty')
      const finding = result.findings?.find(
        (f) => f.rule === 'github-pat-classic' && f.source === source,
      )
      expect(finding, `no finding at source=${source}`).toBeDefined()
    })
  }

  test('github-pat-classic at source=env (non-curated-key) is reported by scan', async () => {
    // Use a key that does NOT match the curated env-key list so the pattern
    // path fires (not the env-key-match path).
    const cassettePath = path.join(tmp, 'source-env-pattern.json')
    const recording = {
      call: {
        command: 'echo',
        args: [],
        cwd: null,
        env: { SOME_ENV_VAR: PAT },
        stdin: null,
      },
      result: {
        stdoutLines: [],
        stderrLines: [],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 10,
        aborted: false,
      },
      redactions: [],
    }
    const cassette: CassetteFile = { version: 2, recordedBy: null, recordings: [recording] }
    await writeCassetteFile(cassettePath, serialize(cassette))

    const result = await scanOne(cassettePath, baseConfig, false)

    expect(result.status).toBe('dirty')
    const finding = result.findings?.find(
      (f) => f.rule === 'github-pat-classic' && f.source === 'env',
    )
    expect(finding, 'no github-pat-classic finding in env via pattern path').toBeDefined()
  })
})

describe('env-key-match symmetry: opaque values under curated env keys are reported', () => {
  // These values do NOT match any regex pattern but will trigger via env-key-match
  // because the key contains a curated substring.
  const CURATED_KEY_CASES: Array<{ key: string; curatedSubstring: string }> = [
    { key: 'GITHUB_TOKEN', curatedSubstring: 'TOKEN' },
    { key: 'GH_TOKEN', curatedSubstring: 'TOKEN' },
    { key: 'MY_SECRET', curatedSubstring: 'SECRET' },
    { key: 'DB_PASSWORD', curatedSubstring: 'PASSWORD' },
    { key: 'AWS_SECRET_ACCESS_KEY', curatedSubstring: 'SECRET' },
    { key: 'SOME_API_KEY', curatedSubstring: 'API_KEY' },
    { key: 'MY_JWT', curatedSubstring: 'JWT' },
  ]

  for (const { key } of CURATED_KEY_CASES) {
    test(`opaque value under ${key} produces env-key-match finding`, async () => {
      const opaqueValue = 'opaque-format-not-matching-any-regex'
      const cassettePath = path.join(tmp, `env-key-${key}.json`)
      const recording = {
        call: {
          command: 'echo',
          args: [],
          cwd: null,
          env: { [key]: opaqueValue },
          stdin: null,
        },
        result: {
          stdoutLines: [],
          stderrLines: [],
          allLines: null,
          exitCode: 0,
          signal: null,
          durationMs: 10,
          aborted: false,
        },
        redactions: [],
      }
      const cassette: CassetteFile = { version: 2, recordedBy: null, recordings: [recording] }
      await writeCassetteFile(cassettePath, serialize(cassette))

      const result = await scanOne(cassettePath, baseConfig, false)

      expect(result.status, `key ${key}: expected dirty`).toBe('dirty')
      const finding = result.findings?.find(
        (f) => f.source === 'env' && f.rule === ENV_KEY_MATCH_RULE,
      )
      expect(finding, `key ${key}: no env-key-match finding`).toBeDefined()
    })
  }
})

describe('negative direction: clean values produce no findings (best effort)', () => {
  test('random short strings without credential shapes produce no findings', async () => {
    // Filter aggressively: exclude strings matching any bundled pattern prefix
    // or containing curated env-key substrings (which would fire via a different path).
    // This is intentionally loose; we're testing that scan doesn't false-positive
    // on genuinely innocent strings.
    const credentialPrefixes =
      /^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|AKIA|ASIA|AROA|AIDA|AGPA|ANPA|ANVA|APKA|ABIA|ACCA|sk_live_|sk_test_|rk_live_|rk_test_|sk-ant-|sk-|AIza|xox[baprso]-|glpat-|npm_|dop_v1_|SG\.|key-[a-f0-9]{32}|hf_|pypi-AgE|EAAA)/
    const containsWebhookUrl = (s: string) => s.includes('hooks.slack.com')
    const containsDiscordShape = (s: string) => /^[MN][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\./.test(s)

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => {
          return !credentialPrefixes.test(s) && !containsWebhookUrl(s) && !containsDiscordShape(s)
        }),
        async (value) => {
          const cassettePath = path.join(tmp, `neg-${Math.random().toString(36).slice(2)}.json`)
          const cassette = buildCassette('args', value)
          await writeCassetteFile(cassettePath, serialize(cassette))

          const result = await scanOne(cassettePath, baseConfig, false)
          return result.status === 'clean'
        },
      ),
      { numRuns: 50 },
    )
  })
})
