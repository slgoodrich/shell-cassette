import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { defaultCanonicalize, MatcherState } from '../../src/matcher.js'
import { normalizeTmpPath } from '../../src/normalize.js'
import type { Call, Recording } from '../../src/types.js'

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

const dummyResult = {
  stdoutLines: [''],
  stderrLines: [''],
  allLines: null,
  exitCode: 0,
  signal: null,
  durationMs: 0,
  aborted: false,
}

const recOf = (call: Call): Recording => ({ call, result: dummyResult })

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
    // Generate strings that don't contain any tmp prefix substring
    const genNonTmp = fc
      .string()
      .filter(
        (s) =>
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
        expect(defaultCanonicalize(call)).toEqual(defaultCanonicalize(call))
      }),
      { numRuns: 100 },
    )
  })

  test('omits cwd, env, stdin from canonical form', () => {
    fc.assert(
      fc.property(genCall, (call) => {
        const c = defaultCanonicalize(call)
        expect(c.cwd).toBeUndefined()
        expect(c.env).toBeUndefined()
        expect(c.stdin).toBeUndefined()
      }),
      { numRuns: 100 },
    )
  })
})

describe('MatcherState properties', () => {
  test('equal canonical forms imply match succeeds', () => {
    // Take a recording made from a call; the same call must match it
    fc.assert(
      fc.property(genCall, (call) => {
        const state = new MatcherState([recOf(call)], defaultCanonicalize)
        const matched = state.findMatch(call)
        expect(matched).not.toBeNull()
      }),
      { numRuns: 100 },
    )
  })

  test('sequential consumption: N copies match N times then exhaust', () => {
    fc.assert(
      fc.property(genCall, fc.integer({ min: 1, max: 8 }), (call, n) => {
        const recordings = Array.from({ length: n }, () => recOf(call))
        const state = new MatcherState(recordings, defaultCanonicalize)
        for (let i = 0; i < n; i++) {
          expect(state.findMatch(call)).not.toBeNull()
        }
        expect(state.findMatch(call)).toBeNull()
      }),
      { numRuns: 50 },
    )
  })
})
