import { describe, expect, test } from 'vitest'
import { runPipeline, seedCountersFromCassette, stripCounter } from '../../src/redact-pipeline.js'
import type { CassetteFile, RedactConfig } from '../../src/types.js'

const baseConfig: RedactConfig = {
  bundledPatterns: false,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

describe('redact-pipeline: suppress short-circuit', () => {
  test('suppress regex match exempts the value from all rules', () => {
    const config: RedactConfig = {
      ...baseConfig,
      suppressPatterns: [/^FAKE_/],
    }
    const result = runPipeline(
      { source: 'env', value: 'FAKE_ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890' },
      config,
      { counted: false },
    )
    expect(result.output).toBe('FAKE_ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
    expect(result.entries).toEqual([])
    expect(result.warnings).toEqual([])
  })

  test('value not matching any suppress regex falls through unchanged when no rules apply', () => {
    const config: RedactConfig = { ...baseConfig, suppressPatterns: [/^FAKE_/] }
    const result = runPipeline({ source: 'env', value: 'normal-value' }, config, { counted: false })
    expect(result.output).toBe('normal-value')
    expect(result.entries).toEqual([])
  })

  test('g-flagged suppress pattern: all three consecutive matching calls suppress correctly (lastIndex bug)', () => {
    // A g-flagged regex retains lastIndex between .test() calls. Without resetting
    // lastIndex to 0 before each call, the second (or third) call against a different
    // string may incorrectly return false even though the string matches.
    const config: RedactConfig = {
      ...baseConfig,
      suppressPatterns: [/secret/gi],
    }
    const v1 = runPipeline({ source: 'env', value: 'my-secret-token-1' }, config, {
      counted: false,
    })
    const v2 = runPipeline({ source: 'env', value: 'my-secret-token-2' }, config, {
      counted: false,
    })
    const v3 = runPipeline({ source: 'env', value: 'my-secret-token-3' }, config, {
      counted: false,
    })
    // All three values match the suppress pattern; all three must be suppressed.
    expect(v1.output).toBe('my-secret-token-1')
    expect(v2.output).toBe('my-secret-token-2')
    expect(v3.output).toBe('my-secret-token-3')
    expect(v1.entries).toEqual([])
    expect(v2.entries).toEqual([])
    expect(v3.entries).toEqual([])
  })
})

describe('redact-pipeline: bundled patterns', () => {
  test('bundle disabled: no rules apply even when value matches a bundled pattern', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: false }
    const value = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const result = runPipeline({ source: 'stdout', value }, config, { counted: false })
    expect(result.output).toBe(value)
    expect(result.entries).toEqual([])
  })

  test('bundle enabled, stripped mode: replaces match with stripped placeholder', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const value = 'token: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890 end'
    const result = runPipeline({ source: 'stdout', value }, config, { counted: false })
    expect(result.output).toBe('token: <redacted:stdout:github-pat-classic> end')
    expect(result.entries).toEqual([{ rule: 'github-pat-classic', source: 'stdout', count: 1 }])
  })

  test('bundle enabled, multiple matches in one value: each replaced; count reflects all', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const t1 = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const t2 = 'ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'
    const value = `a ${t1} b ${t2} c`
    const result = runPipeline({ source: 'stdout', value }, config, { counted: false })
    expect(result.output).toBe(
      'a <redacted:stdout:github-pat-classic> b <redacted:stdout:github-pat-classic> c',
    )
    expect(result.entries).toEqual([{ rule: 'github-pat-classic', source: 'stdout', count: 2 }])
  })

  test('bundle enabled, no match: output unchanged, no entries', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const result = runPipeline({ source: 'stdout', value: 'hello world' }, config, {
      counted: false,
    })
    expect(result.output).toBe('hello world')
    expect(result.entries).toEqual([])
  })

  test('bundled rule fires when bundle enabled (smoke check, single rule)', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const result = runPipeline({ source: 'env', value: `AIza${'a'.repeat(35)}` }, config, {
      counted: false,
    })
    expect(result.output).toBe('<redacted:env:google-api-key>')
  })

  test('all 25 bundled rules are wired into the pipeline (per-rule smoke)', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    // For each bundled rule, construct a sample value matching its pattern
    // and verify the pipeline produces the corresponding placeholder.
    const samples: { name: string; value: string }[] = [
      { name: 'github-pat-classic', value: `ghp_${'a'.repeat(36)}` },
      { name: 'github-pat-fine-grained', value: `github_pat_${'A'.repeat(82)}` },
      { name: 'github-oauth', value: `gho_${'a'.repeat(36)}` },
      { name: 'github-user-to-server', value: `ghu_${'a'.repeat(36)}` },
      { name: 'github-server-to-server', value: `ghs_${'a'.repeat(36)}` },
      { name: 'github-refresh', value: `ghr_${'a'.repeat(36)}` },
      { name: 'aws-access-key-id', value: 'AKIA0123456789ABCDEF' },
      { name: 'stripe-secret-live', value: `sk_live_${'a'.repeat(24)}` },
      { name: 'stripe-secret-test', value: `sk_test_${'a'.repeat(24)}` },
      { name: 'stripe-restricted-live', value: `rk_live_${'a'.repeat(24)}` },
      { name: 'stripe-restricted-test', value: `rk_test_${'a'.repeat(24)}` },
      { name: 'anthropic-api-key', value: `sk-ant-api03-${'a'.repeat(80)}` },
      { name: 'openai-api-key', value: `sk-${'a'.repeat(48)}` },
      { name: 'google-api-key', value: `AIza${'a'.repeat(35)}` },
      { name: 'slack-token', value: 'xoxb-1234567890' },
      {
        name: 'slack-webhook-url',
        value: 'https://hooks.slack.com/services/T0AB12CDE/B0FG34HIJ/0123456789ABCDEF',
      },
      { name: 'gitlab-pat', value: `glpat-${'a'.repeat(20)}` },
      { name: 'npm-token', value: `npm_${'a'.repeat(36)}` },
      { name: 'digitalocean-pat', value: `dop_v1_${'0'.repeat(64)}` },
      { name: 'sendgrid-api-key', value: `SG.${'a'.repeat(22)}.${'a'.repeat(43)}` },
      { name: 'mailgun-api-key', value: `key-${'0'.repeat(32)}` },
      { name: 'huggingface-token', value: `hf_${'a'.repeat(34)}` },
      { name: 'pypi-token', value: `pypi-AgE${'a'.repeat(50)}` },
      { name: 'discord-bot-token', value: `M${'a'.repeat(23)}.${'a'.repeat(6)}.${'a'.repeat(27)}` },
      { name: 'square-production-token', value: `EAAA${'a'.repeat(60)}` },
    ]
    expect(samples.length).toBe(25)
    for (const sample of samples) {
      const result = runPipeline({ source: 'stdout', value: sample.value }, config, {
        counted: false,
      })
      expect(result.output).toBe(`<redacted:stdout:${sample.name}>`)
      expect(result.entries.some((e) => e.rule === sample.name)).toBe(true)
    }
  })
})

describe('redact-pipeline: custom rules', () => {
  test('regex custom rule (no g flag) applies after bundle and is normalized', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      customPatterns: [{ name: 'my-secret', pattern: /SECRET-[A-Z0-9]+/ }],
    }
    const result = runPipeline(
      { source: 'stdout', value: 'before SECRET-ABC123 after SECRET-XYZ789 end' },
      config,
      { counted: false },
    )
    expect(result.output).toBe(
      'before <redacted:stdout:my-secret> after <redacted:stdout:my-secret> end',
    )
    expect(result.entries).toEqual([{ rule: 'my-secret', source: 'stdout', count: 2 }])
  })

  test('regex custom rule (with g flag) works the same', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      customPatterns: [{ name: 'my-secret', pattern: /SECRET-[A-Z0-9]+/g }],
    }
    const result = runPipeline(
      { source: 'stdout', value: 'before SECRET-ABC123 after SECRET-XYZ789 end' },
      config,
      { counted: false },
    )
    expect(result.output).toBe(
      'before <redacted:stdout:my-secret> after <redacted:stdout:my-secret> end',
    )
    expect(result.entries).toEqual([{ rule: 'my-secret', source: 'stdout', count: 2 }])
  })

  test('function custom rule receives the value and returns the replacement', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      customPatterns: [{ name: 'uppercase', pattern: (s: string) => s.toUpperCase() }],
    }
    const result = runPipeline({ source: 'env', value: 'hello world' }, config, { counted: false })
    expect(result.output).toBe('HELLO WORLD')
    expect(result.entries).toEqual([{ rule: 'uppercase', source: 'env', count: 1 }])
  })

  test('function rule that does not transform: count stays 0, no entry', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      customPatterns: [{ name: 'noop', pattern: (s: string) => s }],
    }
    const result = runPipeline({ source: 'env', value: 'unchanged' }, config, { counted: false })
    expect(result.output).toBe('unchanged')
    expect(result.entries).toEqual([])
  })

  test('bundle and custom can both fire on the same value', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: true,
      customPatterns: [{ name: 'my-fake', pattern: /TEST_TOKEN_[A-Z0-9]+/ }],
    }
    const value = 'gh: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890 / fake: TEST_TOKEN_ABC'
    const result = runPipeline({ source: 'args', value }, config, { counted: false })
    expect(result.output).toContain('<redacted:args:github-pat-classic>')
    expect(result.output).toContain('<redacted:args:my-fake>')
    expect(result.entries).toEqual([
      { rule: 'github-pat-classic', source: 'args', count: 1 },
      { rule: 'my-fake', source: 'args', count: 1 },
    ])
  })
})

describe('redact-pipeline: length warning', () => {
  test('value > threshold + no path/whitespace + no rule fired: warning emitted', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      warnLengthThreshold: 40,
      warnPathHeuristic: true,
    }
    const value = 'a'.repeat(50)
    const result = runPipeline({ source: 'env', value }, config, { counted: false })
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toContain('env')
    expect(result.warnings[0]).toContain('50')
  })

  test('value at exactly threshold: no warning', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      warnLengthThreshold: 40,
      warnPathHeuristic: true,
    }
    const result = runPipeline({ source: 'env', value: 'a'.repeat(40) }, config, { counted: false })
    expect(result.warnings).toEqual([])
  })

  test('value > threshold + contains slash: path heuristic suppresses warning', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      warnLengthThreshold: 40,
      warnPathHeuristic: true,
    }
    const value = '/usr/lib/jvm/java-17-openjdk-amd64/bin/java-very-long'
    const result = runPipeline({ source: 'env', value }, config, { counted: false })
    expect(result.warnings).toEqual([])
  })

  test('value > threshold + contains backslash: path heuristic suppresses', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      warnLengthThreshold: 40,
      warnPathHeuristic: true,
    }
    const value = 'C:\\Users\\steve\\AppData\\Local\\Temp\\very-long-filename.txt'
    const result = runPipeline({ source: 'env', value }, config, { counted: false })
    expect(result.warnings).toEqual([])
  })

  test('value > threshold + contains colon: path heuristic suppresses', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      warnLengthThreshold: 40,
      warnPathHeuristic: true,
    }
    const value = 'host:port:database:longish-connection-string-config'
    const result = runPipeline({ source: 'env', value }, config, { counted: false })
    expect(result.warnings).toEqual([])
  })

  test('value > threshold + contains space: path heuristic suppresses', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      warnLengthThreshold: 40,
      warnPathHeuristic: true,
    }
    const value = 'this is a long config string that contains spaces and is over 40 chars'
    const result = runPipeline({ source: 'env', value }, config, { counted: false })
    expect(result.warnings).toEqual([])
  })

  test('warnPathHeuristic disabled: long path-like values DO warn', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      warnLengthThreshold: 40,
      warnPathHeuristic: false,
    }
    const value = '/usr/lib/jvm/java-17-openjdk-amd64-very-long-path'
    const result = runPipeline({ source: 'env', value }, config, { counted: false })
    expect(result.warnings.length).toBe(1)
  })

  test('value redacted by a rule: NO length warning', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: true,
      warnLengthThreshold: 10,
      warnPathHeuristic: true,
    }
    const value = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const result = runPipeline({ source: 'stdout', value }, config, { counted: false })
    expect(result.warnings).toEqual([])
  })
})

describe('redact-pipeline: counter management', () => {
  test('counted mode increments per emission within a session', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const counters = new Map<string, number>()
    const value1 = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const value2 = 'ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'

    const r1 = runPipeline({ source: 'env', value: value1 }, config, { counted: true, counters })
    expect(r1.output).toBe('<redacted:env:github-pat-classic:1>')

    const r2 = runPipeline({ source: 'env', value: value2 }, config, { counted: true, counters })
    expect(r2.output).toBe('<redacted:env:github-pat-classic:2>')
  })

  test('counter scope is per (source, rule)', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const counters = new Map<string, number>()
    const value = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'

    const r1 = runPipeline({ source: 'env', value }, config, { counted: true, counters })
    expect(r1.output).toBe('<redacted:env:github-pat-classic:1>')

    const r2 = runPipeline({ source: 'stdout', value }, config, { counted: true, counters })
    expect(r2.output).toBe('<redacted:stdout:github-pat-classic:1>')

    const aws = 'AKIA0123456789ABCDEF'
    const r3 = runPipeline({ source: 'env', value: aws }, config, { counted: true, counters })
    expect(r3.output).toBe('<redacted:env:aws-access-key-id:1>')
  })

  test('multiple matches in single value increment counter for each', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const counters = new Map<string, number>()
    const t1 = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const t2 = 'ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'
    const value = `${t1} and ${t2}`
    const result = runPipeline({ source: 'stdout', value }, config, { counted: true, counters })
    expect(result.output).toBe(
      '<redacted:stdout:github-pat-classic:1> and <redacted:stdout:github-pat-classic:2>',
    )
  })

  test('stripped mode produces same output regardless of counter state', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const value = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const r1 = runPipeline({ source: 'args', value }, config, { counted: false })
    const r2 = runPipeline({ source: 'args', value }, config, { counted: false })
    expect(r1.output).toBe(r2.output)
    expect(r1.output).toBe('<redacted:args:github-pat-classic>')
  })

  test('function custom rules in counted mode return whatever the function produces (no placeholder)', () => {
    const config: RedactConfig = {
      ...baseConfig,
      bundledPatterns: false,
      customPatterns: [{ name: 'shouty', pattern: (s: string) => s.toUpperCase() }],
    }
    const counters = new Map<string, number>()
    const result = runPipeline({ source: 'env', value: 'hello' }, config, {
      counted: true,
      counters,
    })
    // Function rules bypass the placeholder mechanism; the function's return value
    // is the output. Counter map is not touched (counters scope only the placeholder path).
    expect(result.output).toBe('HELLO')
    expect(result.entries).toEqual([{ rule: 'shouty', source: 'env', count: 1 }])
    expect(counters.size).toBe(0)
  })
})

describe('stripCounter', () => {
  test('removes :N from a single placeholder', () => {
    expect(stripCounter('<redacted:env:github-pat-classic:1>')).toBe(
      '<redacted:env:github-pat-classic>',
    )
  })

  test('removes :N from multiple placeholders in one string', () => {
    const input =
      'a <redacted:stdout:github-pat-classic:1> b <redacted:stdout:github-pat-classic:2> c'
    expect(stripCounter(input)).toBe(
      'a <redacted:stdout:github-pat-classic> b <redacted:stdout:github-pat-classic> c',
    )
  })

  test('leaves non-placeholder text alone', () => {
    expect(stripCounter('hello world')).toBe('hello world')
    expect(stripCounter('Bearer ghp_real')).toBe('Bearer ghp_real')
  })

  test('leaves stripped placeholders unchanged', () => {
    expect(stripCounter('<redacted:env:rule>')).toBe('<redacted:env:rule>')
  })
})

const emptyRec = (): CassetteFile['recordings'][number] => ({
  call: { command: 'curl', args: [], cwd: null, env: {}, stdin: null },
  result: {
    stdoutLines: [],
    stderrLines: [],
    allLines: null,
    exitCode: 0,
    signal: null,
    durationMs: 0,
    aborted: false,
  },
  redactions: [],
})

describe('seedCountersFromCassette', () => {
  test('returns empty map for cassette with no recordings', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: { name: 'shell-cassette', version: '0.4.0' },
      recordings: [],
    }
    const counters = seedCountersFromCassette(cassette)
    expect(counters.size).toBe(0)
  })

  test('seeds from per-recording redactions metadata', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        {
          ...emptyRec(),
          redactions: [
            { rule: 'github-pat-classic', source: 'env', count: 3 },
            { rule: 'aws-access-key-id', source: 'args', count: 1 },
          ],
        },
      ],
    }
    const counters = seedCountersFromCassette(cassette)
    expect(counters.get('env:github-pat-classic')).toBe(3)
    expect(counters.get('args:aws-access-key-id')).toBe(1)
  })

  test('seeds from placeholder counters in body when metadata is stale', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        {
          ...emptyRec(),
          call: {
            command: 'curl',
            args: ['Bearer <redacted:args:github-pat-classic:5>'],
            cwd: null,
            env: {},
            stdin: null,
          },
        },
      ],
    }
    const counters = seedCountersFromCassette(cassette)
    expect(counters.get('args:github-pat-classic')).toBe(5)
  })

  test('takes max when both metadata and body contribute', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        {
          ...emptyRec(),
          call: {
            command: 'curl',
            args: ['<redacted:args:github-pat-classic:7>'],
            cwd: null,
            env: {},
            stdin: null,
          },
          redactions: [{ rule: 'github-pat-classic', source: 'args', count: 4 }],
        },
      ],
    }
    const counters = seedCountersFromCassette(cassette)
    // Body has :7, metadata has :4. Max wins.
    expect(counters.get('args:github-pat-classic')).toBe(7)
  })

  test('walks all 5 sources in body', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        {
          ...emptyRec(),
          call: {
            command: 'curl',
            args: ['<redacted:args:r:1>'],
            cwd: null,
            env: { FOO: '<redacted:env:r:2>' },
            stdin: null,
          },
          result: {
            stdoutLines: ['<redacted:stdout:r:3>'],
            stderrLines: ['<redacted:stderr:r:4>'],
            allLines: ['<redacted:allLines:r:5>'],
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
        },
      ],
    }
    const counters = seedCountersFromCassette(cassette)
    expect(counters.get('args:r')).toBe(1)
    expect(counters.get('env:r')).toBe(2)
    expect(counters.get('stdout:r')).toBe(3)
    expect(counters.get('stderr:r')).toBe(4)
    expect(counters.get('allLines:r')).toBe(5)
  })

  test('multiple recordings: counts accumulate (sum) across recordings', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        {
          call: { command: 'curl', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          redactions: [{ rule: 'r', source: 'env', count: 2 }],
        },
        {
          call: { command: 'curl', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          redactions: [{ rule: 'r', source: 'env', count: 5 }],
        },
      ],
    }
    const counters = seedCountersFromCassette(cassette)
    // rec1 count=2 (placeholders :1, :2) + rec2 count=5 (placeholders :3..:7)
    // Sum = 7. Next emission should produce :8.
    expect(counters.get('env:r')).toBe(7)
  })
})
