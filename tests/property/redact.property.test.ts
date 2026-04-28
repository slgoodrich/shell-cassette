import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { redact } from '../../src/redact.js'
import {
  aggregateEntries,
  seedCountersFromCassette,
  stripCounter,
} from '../../src/redact-pipeline.js'
import type {
  CassetteFile,
  Recording,
  RedactConfig,
  RedactionEntry,
  RedactSource,
} from '../../src/types.js'

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

  test('stripCounter on counter-tagged placeholder yields the stripped form', () => {
    const tokenSegmentArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => /^[a-z][a-z0-9-]*$/.test(s))
    fc.assert(
      fc.property(
        tokenSegmentArb,
        tokenSegmentArb,
        fc.integer({ min: 1, max: 1_000_000 }),
        (source, rule, n) => {
          const tagged = `<redacted:${source}:${rule}:${n}>`
          const stripped = `<redacted:${source}:${rule}>`
          return stripCounter(tagged) === stripped
        },
      ),
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

describe('redact: counter monotonicity', () => {
  test('counted-mode redact never decreases an existing counter value', () => {
    fc.assert(
      fc.property(sourceArb, valueArb, fc.integer({ min: 0, max: 100 }), (source, value, seed) => {
        const counters = new Map<string, number>([['args:github-pat-classic', seed]])
        const before = new Map(counters)
        redact({ source, value }, baseConfig, { counted: true, counters })
        for (const [k, v] of before) {
          if ((counters.get(k) ?? 0) < v) return false
        }
        return true
      }),
    )
  })

  test('post-seed match emits a counter strictly greater than the seeded value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (seed) => {
        const counters = new Map<string, number>([['args:github-pat-classic', seed]])
        const r = redact(
          { source: 'args', value: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890' },
          baseConfig,
          { counted: true, counters },
        )
        const match = r.output.match(/<redacted:args:github-pat-classic:(\d+)>/)
        if (!match) return false
        return Number.parseInt(match[1] ?? '0', 10) > seed
      }),
    )
  })
})

const redactionEntryArb: fc.Arbitrary<RedactionEntry> = fc.record({
  rule: fc.constantFrom(
    'github-pat-classic',
    'aws-access-key-id',
    'openai-api-key',
    'anthropic-api-key',
    'custom-test',
  ),
  source: sourceArb,
  count: fc.integer({ min: 1, max: 10 }),
})

describe('aggregateEntries', () => {
  test('input order does not affect the aggregated output', () => {
    fc.assert(
      fc.property(fc.array(redactionEntryArb, { maxLength: 12 }), (entries) => {
        const reversed = [...entries].reverse()
        const a = aggregateEntries(entries)
        const b = aggregateEntries(reversed)
        const keyOf = (e: RedactionEntry) => `${e.source}:${e.rule}`
        const sortByKey = (xs: readonly RedactionEntry[]) =>
          [...xs].sort((x, y) => keyOf(x).localeCompare(keyOf(y)))
        return JSON.stringify(sortByKey(a)) === JSON.stringify(sortByKey(b))
      }),
    )
  })

  test('total count across entries is preserved', () => {
    fc.assert(
      fc.property(fc.array(redactionEntryArb, { maxLength: 12 }), (entries) => {
        const sum = (xs: readonly RedactionEntry[]) => xs.reduce((s, e) => s + e.count, 0)
        return sum(aggregateEntries(entries)) === sum(entries)
      }),
    )
  })
})

const placeholderValueArb = fc
  .tuple(sourceArb, fc.constantFrom('github-pat-classic', 'aws-access-key-id', 'openai-api-key'))
  .chain(([source, rule]) =>
    fc
      .integer({ min: 1, max: 50 })
      .map((n) => ({ value: `<redacted:${source}:${rule}:${n}>`, source, rule, n })),
  )

const recordingArb: fc.Arbitrary<Recording> = fc.record({
  call: fc.record({
    command: fc.string({ minLength: 1, maxLength: 10 }),
    args: fc.array(
      fc.oneof(
        fc.string({ maxLength: 30 }),
        placeholderValueArb.map((p) => p.value),
      ),
      { maxLength: 4 },
    ),
    cwd: fc.constant(null),
    env: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[A-Z_]+$/.test(s)),
      fc.oneof(
        fc.string({ maxLength: 30 }),
        placeholderValueArb.map((p) => p.value),
      ),
      { maxKeys: 3 },
    ),
    stdin: fc.constant(null),
  }),
  result: fc.record({
    stdoutLines: fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
    stderrLines: fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
    allLines: fc.constant(null),
    exitCode: fc.integer({ min: 0, max: 255 }),
    signal: fc.constant(null),
    durationMs: fc.integer({ min: 0, max: 10_000 }),
    aborted: fc.boolean(),
  }),
  redactions: fc.array(redactionEntryArb, { maxLength: 4 }),
})

const cassetteArb: fc.Arbitrary<CassetteFile> = fc.record({
  version: fc.constant(2 as const),
  recordedBy: fc.constant(null),
  recordings: fc.array(recordingArb, { maxLength: 4 }),
})

describe('seedCountersFromCassette', () => {
  test('deterministic: same cassette yields the same counter map', () => {
    fc.assert(
      fc.property(cassetteArb, (cassette) => {
        const m1 = seedCountersFromCassette(cassette)
        const m2 = seedCountersFromCassette(cassette)
        if (m1.size !== m2.size) return false
        for (const [k, v] of m1) {
          if (m2.get(k) !== v) return false
        }
        return true
      }),
    )
  })

  test('seeded values are >= every counter-tagged placeholder N for that (source, rule)', () => {
    fc.assert(
      fc.property(cassetteArb, (cassette) => {
        const seeded = seedCountersFromCassette(cassette)
        const placeholderRe = /<redacted:([^:>]+):([^:>]+):(\d+)>/g
        for (const rec of cassette.recordings) {
          const values = [
            ...Object.values(rec.call.env),
            ...rec.call.args,
            ...rec.result.stdoutLines,
            ...rec.result.stderrLines,
          ]
          for (const v of values) {
            placeholderRe.lastIndex = 0
            for (const m of v.matchAll(placeholderRe)) {
              const key = `${m[1]}:${m[2]}`
              const n = Number.parseInt(m[3] ?? '0', 10)
              const seedVal = seeded.get(key) ?? 0
              if (seedVal < n) return false
            }
          }
        }
        return true
      }),
    )
  })
})
