/**
 * Property test: scan vs record symmetry.
 *
 * The load-bearing security guarantee: if record mode would have redacted a
 * value, scan must report that value as a finding. These tests verify the
 * forward direction of that guarantee for every bundled rule and for the
 * env-key-match path.
 */
import path from 'node:path'
import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { scanOne } from '../../src/cli-scan.js'
import { writeCassetteFile } from '../../src/io.js'
import { BUNDLED_PATTERNS } from '../../src/redact.js'
import { ENV_KEY_MATCH_RULE } from '../../src/redact-pipeline.js'
import { serialize } from '../../src/serialize.js'
import type { CassetteFile, RedactConfig, RedactSource } from '../../src/types.js'
import {
  SAMPLE_ANTHROPIC_API_KEY,
  SAMPLE_AWS_ACCESS_KEY_ID,
  SAMPLE_DIGITALOCEAN_PAT,
  SAMPLE_DISCORD_BOT_TOKEN,
  SAMPLE_GITHUB_OAUTH,
  SAMPLE_GITHUB_PAT_CLASSIC,
  SAMPLE_GITHUB_PAT_FINE_GRAINED,
  SAMPLE_GITHUB_REFRESH,
  SAMPLE_GITHUB_SERVER_TO_SERVER,
  SAMPLE_GITHUB_USER_TO_SERVER,
  SAMPLE_GITLAB_PAT,
  SAMPLE_GOOGLE_API_KEY,
  SAMPLE_HUGGINGFACE_TOKEN,
  SAMPLE_MAILGUN_API_KEY,
  SAMPLE_NPM_TOKEN,
  SAMPLE_OPENAI_API_KEY,
  SAMPLE_PYPI_TOKEN,
  SAMPLE_SENDGRID_API_KEY,
  SAMPLE_SLACK_TOKEN,
  SAMPLE_SLACK_WEBHOOK_URL,
  SAMPLE_SQUARE_PRODUCTION_TOKEN,
  SAMPLE_STRIPE_RESTRICTED_LIVE,
  SAMPLE_STRIPE_RESTRICTED_TEST,
  SAMPLE_STRIPE_SECRET_LIVE,
  SAMPLE_STRIPE_SECRET_TEST,
} from '../helpers/credential-fixtures.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const baseConfig: RedactConfig = {
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

const tmpDir = useTmpDir('sc-symmetry-')

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
    suppressed: [],
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
  'github-pat-classic': SAMPLE_GITHUB_PAT_CLASSIC,
  'github-pat-fine-grained': SAMPLE_GITHUB_PAT_FINE_GRAINED,
  'github-oauth': SAMPLE_GITHUB_OAUTH,
  'github-user-to-server': SAMPLE_GITHUB_USER_TO_SERVER,
  'github-server-to-server': SAMPLE_GITHUB_SERVER_TO_SERVER,
  'github-refresh': SAMPLE_GITHUB_REFRESH,
  'aws-access-key-id': SAMPLE_AWS_ACCESS_KEY_ID,
  'stripe-secret-live': SAMPLE_STRIPE_SECRET_LIVE,
  'stripe-secret-test': SAMPLE_STRIPE_SECRET_TEST,
  'stripe-restricted-live': SAMPLE_STRIPE_RESTRICTED_LIVE,
  'stripe-restricted-test': SAMPLE_STRIPE_RESTRICTED_TEST,
  'anthropic-api-key': SAMPLE_ANTHROPIC_API_KEY,
  'openai-api-key': SAMPLE_OPENAI_API_KEY,
  'google-api-key': SAMPLE_GOOGLE_API_KEY,
  'slack-token': SAMPLE_SLACK_TOKEN,
  'slack-webhook-url': SAMPLE_SLACK_WEBHOOK_URL,
  'gitlab-pat': SAMPLE_GITLAB_PAT,
  'npm-token': SAMPLE_NPM_TOKEN,
  'digitalocean-pat': SAMPLE_DIGITALOCEAN_PAT,
  'sendgrid-api-key': SAMPLE_SENDGRID_API_KEY,
  'mailgun-api-key': SAMPLE_MAILGUN_API_KEY,
  'huggingface-token': SAMPLE_HUGGINGFACE_TOKEN,
  'pypi-token': SAMPLE_PYPI_TOKEN,
  'discord-bot-token': SAMPLE_DISCORD_BOT_TOKEN,
  'square-production-token': SAMPLE_SQUARE_PRODUCTION_TOKEN,
}

describe('per-rule forward symmetry: redact fires implies scan finds', () => {
  test('all 25 bundled patterns: placing credential in args yields a scan finding with matching rule name', async () => {
    for (const rule of BUNDLED_PATTERNS) {
      const sample = RULE_SAMPLES[rule.name]
      expect(sample, `missing sample for rule: ${rule.name}`).toBeDefined()

      const cassettePath = path.join(tmpDir.ref(), `rule-${rule.name}.json`)
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
  const PAT = SAMPLE_GITHUB_PAT_CLASSIC
  const SOURCES: RedactSource[] = ['args', 'stdout', 'stderr', 'allLines']

  for (const source of SOURCES) {
    test(`github-pat-classic at source=${source} is reported by scan`, async () => {
      const cassettePath = path.join(tmpDir.ref(), `source-${source}.json`)
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
    const cassettePath = path.join(tmpDir.ref(), 'source-env-pattern.json')
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
      suppressed: [],
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
      const cassettePath = path.join(tmpDir.ref(), `env-key-${key}.json`)
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
          const cassettePath = path.join(
            tmpDir.ref(),
            `neg-${Math.random().toString(36).slice(2)}.json`,
          )
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
