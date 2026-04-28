import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { redact } from '../../src/redact.js'
import { stripCounter } from '../../src/redact-pipeline.js'
import type { RedactConfig, RedactSource } from '../../src/types.js'

const baseConfig: RedactConfig = {
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

const sourceArb = fc.constantFrom<RedactSource>('env', 'args', 'stdout', 'stderr', 'allLines')
const valueArb = fc.string({ maxLength: 200 })

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('redact: idempotence', () => {
  test('redacting redact output yields the same output (placeholders do not re-match)', () => {
    fc.assert(
      fc.property(sourceArb, valueArb, (source, value) => {
        const counters1 = new Map<string, number>()
        const r1 = redact({ source, value }, baseConfig, { counted: true, counters: counters1 })
        const counters2 = new Map<string, number>(counters1)
        const r2 = redact({ source, value: r1.output }, baseConfig, {
          counted: true,
          counters: counters2,
        })
        return r2.output === r1.output
      }),
    )
  })
})

describe('redact: determinism', () => {
  test('same input + same config + same counter state produces same output', () => {
    fc.assert(
      fc.property(sourceArb, valueArb, (source, value) => {
        const counters1 = new Map<string, number>()
        const counters2 = new Map<string, number>()
        const r1 = redact({ source, value }, baseConfig, { counted: true, counters: counters1 })
        const r2 = redact({ source, value }, baseConfig, { counted: true, counters: counters2 })
        return r1.output === r2.output
      }),
    )
  })

  test('stripped mode is deterministic regardless of counter state', () => {
    fc.assert(
      fc.property(sourceArb, valueArb, (source, value) => {
        const r1 = redact({ source, value }, baseConfig, { counted: false })
        const r2 = redact({ source, value }, baseConfig, { counted: false })
        return r1.output === r2.output
      }),
    )
  })
})

describe('redact: stripped form has no counter substrings', () => {
  test('stripped output never contains a :N> suffix', () => {
    fc.assert(
      fc.property(sourceArb, valueArb, (source, value) => {
        const r = redact({ source, value }, baseConfig, { counted: false })
        return !/<redacted:[^:]+:[^:]+:\d+>/.test(r.output)
      }),
    )
  })
})

describe('stripCounter: idempotence', () => {
  test('stripCounter(stripCounter(x)) === stripCounter(x)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        return stripCounter(stripCounter(s)) === stripCounter(s)
      }),
    )
  })
})

describe('redact: suppress short-circuit', () => {
  test('value matching any suppress regex is exempt from redaction', () => {
    fc.assert(
      fc.property(sourceArb, fc.string({ minLength: 1, maxLength: 50 }), (source, value) => {
        const config: RedactConfig = {
          ...baseConfig,
          suppressPatterns: [new RegExp(escapeRegex(value))],
        }
        const r = redact({ source, value }, config, { counted: false })
        return r.output === value && r.entries.length === 0
      }),
    )
  })
})

describe('BUNDLED_PATTERNS: counter mode emits unique-per-rule placeholders', () => {
  test('two distinct credential matches produce :1 and :2 in counted mode', () => {
    const t1 = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const t2 = 'ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'
    const counters = new Map<string, number>()
    const r1 = redact({ source: 'args', value: t1 }, baseConfig, { counted: true, counters })
    const r2 = redact({ source: 'args', value: t2 }, baseConfig, { counted: true, counters })
    expect(r1.output).toBe('<redacted:args:github-pat-classic:1>')
    expect(r2.output).toBe('<redacted:args:github-pat-classic:2>')
  })
})
