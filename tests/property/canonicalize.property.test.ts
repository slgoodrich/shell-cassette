import * as fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { defaultCanonicalize, MatcherState } from '../../src/matcher.js'
import { normalizeTmpPath, TMP_TOKEN } from '../../src/normalize.js'
import type { Call, Recording, Result } from '../../src/types.js'

// Reuse generators (deliberate inline duplication — rule of three; two
// property test files don't justify a shared helpers module yet)
const genArg = fc.string({ minLength: 0, maxLength: 50 }).filter((s) => !s.includes('\n'))
const genArgs = fc.array(genArg, { minLength: 0, maxLength: 5 })
const genCommand = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !s.includes('\n') && s.trim().length > 0)

const genCall: fc.Arbitrary<Call> = fc.record({
  command: genCommand,
  args: genArgs,
  cwd: fc.option(
    fc.string({ maxLength: 30 }).filter((s) => !s.includes('\n')),
    { nil: null },
  ),
  env: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[A-Z_]+$/.test(s)),
    fc.string({ maxLength: 30 }).filter((s) => !s.includes('\n')),
    { maxKeys: 3 },
  ),
  stdin: fc.constant(null),
})

const dummyResult: Result = {
  stdoutLines: [''],
  stderrLines: [''],
  allLines: null,
  exitCode: 0,
  signal: null,
  durationMs: 0,
  aborted: false,
}

const recOf = (call: Call): Recording => ({
  call,
  result: dummyResult,
  redactions: [],
  suppressed: [],
})

describe('normalizeTmpPath properties', () => {
  test('idempotence: normalizeTmpPath(normalizeTmpPath(s)) === normalizeTmpPath(s)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeTmpPath(s)
        const twice = normalizeTmpPath(once)
        expect(twice).toBe(once)
      }),
      { numRuns: 200 },
    )
  })

  test('non-tmp strings are unchanged', () => {
    // Generate strings that contain neither a tmp prefix substring nor the
    // already-normalized TMP_TOKEN. Filtering on TMP_TOKEN prevents this test
    // from accidentally generating "<tmp>/x" which the matcher would treat as
    // already-canonical (passing the assertion for the wrong reason). The
    // explicit prefix list mirrors normalize.ts's TMP_PREFIX_PATTERNS; if a
    // new platform pattern is added there, add it here too.
    const genNonTmp = fc
      .string()
      .filter(
        (s) =>
          !s.includes(TMP_TOKEN) &&
          !s.includes('/tmp/') &&
          !s.includes('/var/tmp/') &&
          !s.includes('/var/folders/') &&
          !s.includes('/private/tmp/') &&
          !/[A-Z]:\\Users\\[^\\]*\\AppData\\Local\\Temp\\/.test(s),
      )
    fc.assert(
      fc.property(genNonTmp, (s) => {
        expect(normalizeTmpPath(s)).toBe(s)
      }),
      { numRuns: 200 },
    )
  })
})

describe('defaultCanonicalize properties', () => {
  test('determinism: same input produces same output', () => {
    fc.assert(
      fc.property(genCall, (call) => {
        expect(defaultCanonicalize(call, DEFAULT_CONFIG.redact)).toEqual(
          defaultCanonicalize(call, DEFAULT_CONFIG.redact),
        )
      }),
      { numRuns: 100 },
    )
  })

  test('omits cwd, env, stdin from canonical form', () => {
    fc.assert(
      fc.property(genCall, (call) => {
        const c = defaultCanonicalize(call, DEFAULT_CONFIG.redact)
        expect(c.cwd).toBeUndefined()
        expect(c.env).toBeUndefined()
        expect(c.stdin).toBeUndefined()
      }),
      { numRuns: 100 },
    )
  })
})

// Suppress the matcher's "ambiguous match" warnings in this describe block.
// The sequential-consumption test deliberately creates N identical recordings,
// which fires the warning every time there are 2+ unconsumed candidates.
// That's correct behavior under test, but ~150 lines of stderr noise per run.
describe('MatcherState properties', () => {
  const originalLog = process.env.SHELL_CASSETTE_LOG
  beforeAll(() => {
    process.env.SHELL_CASSETTE_LOG = 'silent'
  })
  afterAll(() => {
    if (originalLog === undefined) {
      delete process.env.SHELL_CASSETTE_LOG
    } else {
      process.env.SHELL_CASSETTE_LOG = originalLog
    }
  })

  test('equal canonical forms imply match succeeds (calls differ in non-canonical fields)', () => {
    // Build call A and call B that differ in cwd/env (NOT in the canonical form
    // since defaultCanonicalize omits both), and verify B matches a recording of A.
    // This actually tests the canonicalization-driven matching contract, vs. the
    // weaker "single recording matches its own call" tautology.
    fc.assert(
      fc.property(
        genCall,
        fc.string({ maxLength: 30 }).filter((s) => !s.includes('\n')),
        (callA, otherCwd) => {
          const callB: Call = { ...callA, cwd: otherCwd, env: { OTHER: 'value' } }
          const state = new MatcherState([recOf(callA)], defaultCanonicalize, DEFAULT_CONFIG.redact)
          const matched = state.findMatch(callB)
          expect(matched).not.toBeNull()
        },
      ),
      { numRuns: 100 },
    )
  })

  test('sequential consumption: N copies match N times then exhaust', () => {
    fc.assert(
      fc.property(genCall, fc.integer({ min: 1, max: 8 }), (call, n) => {
        const recordings = Array.from({ length: n }, () => recOf(call))
        const state = new MatcherState(recordings, defaultCanonicalize, DEFAULT_CONFIG.redact)
        for (let i = 0; i < n; i++) {
          expect(state.findMatch(call)).not.toBeNull()
        }
        expect(state.findMatch(call)).toBeNull()
      }),
      { numRuns: 50 },
    )
  })
})
