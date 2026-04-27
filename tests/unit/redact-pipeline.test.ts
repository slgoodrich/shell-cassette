import { describe, expect, test } from 'vitest'
import { runPipeline, stripCounter } from '../../src/redact-pipeline.js'
import type { RedactConfig } from '../../src/types.js'

const baseConfig: RedactConfig = {
  bundledPatterns: false,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

// ---------------------------------------------------------------------------
// Task 7: suppress short-circuit
// ---------------------------------------------------------------------------

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
})

// ---------------------------------------------------------------------------
// Task 8: bundled pattern application
// ---------------------------------------------------------------------------

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

  test('all 25 bundled rules are wired into the pipeline (smoke check)', () => {
    const config: RedactConfig = { ...baseConfig, bundledPatterns: true }
    const result = runPipeline({ source: 'env', value: `AIza${'a'.repeat(35)}` }, config, {
      counted: false,
    })
    expect(result.output).toBe('<redacted:env:google-api-key>')
  })
})

// ---------------------------------------------------------------------------
// Task 9: custom rule application
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Task 10: length warning with path heuristic
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Task 11: counter management + stripCounter
// ---------------------------------------------------------------------------

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
