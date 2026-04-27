import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { deserialize, serialize } from '../../src/serialize.js'
import type { Call, CassetteFile, Recording, Result } from '../../src/types.js'

// Generators
const genArg = fc.string({ minLength: 0, maxLength: 50 }).filter((s) => !s.includes('\n'))
const genArgs = fc.array(genArg, { minLength: 0, maxLength: 5 })
const genCommand = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !s.includes('\n') && s.trim().length > 0)

const genCall: fc.Arbitrary<Call> = fc.record({
  command: genCommand,
  args: genArgs,
  cwd: fc.option(
    fc.string({ minLength: 0, maxLength: 30 }).filter((s) => !s.includes('\n')),
    {
      nil: null,
    },
  ),
  env: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[A-Z_]+$/.test(s)),
    fc.string({ minLength: 0, maxLength: 30 }).filter((s) => !s.includes('\n')),
    { maxKeys: 3 },
  ),
  stdin: fc.constant(null),
})

const genResult: fc.Arbitrary<Result> = fc.record({
  stdoutLines: fc.array(
    fc.string({ maxLength: 50 }).filter((s) => !s.includes('\n')),
    {
      maxLength: 5,
    },
  ),
  stderrLines: fc.array(
    fc.string({ maxLength: 50 }).filter((s) => !s.includes('\n')),
    {
      maxLength: 5,
    },
  ),
  allLines: fc.option(
    fc.array(
      fc.string({ maxLength: 50 }).filter((s) => !s.includes('\n')),
      { maxLength: 5 },
    ),
    { nil: null },
  ),
  exitCode: fc.integer({ min: 0, max: 255 }),
  signal: fc.option(fc.constantFrom('SIGTERM', 'SIGKILL', 'SIGINT'), { nil: null }),
  durationMs: fc.integer({ min: 0, max: 10000 }),
  aborted: fc.boolean(),
})

const genRedactionEntry = fc.record({
  rule: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  source: fc.constantFrom(
    'env' as const,
    'args' as const,
    'stdout' as const,
    'stderr' as const,
    'allLines' as const,
  ),
  count: fc.integer({ min: 1, max: 10 }),
})

const genRecording: fc.Arbitrary<Recording> = fc.record({
  call: genCall,
  result: genResult,
  redactions: fc.array(genRedactionEntry, { maxLength: 3 }),
})

// fc.tuple(int, int, int).map(([M, m, p]) => `${M}.${m}.${p}`) generates
// semver strings directly. Earlier versions used fc.string().filter() which
// rejected ~99% of generations and caused test runs to hit the 60s timeout.
const genSemver = fc
  .tuple(
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 0, max: 9 }),
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`)

const genCassetteFile: fc.Arbitrary<CassetteFile> = fc.record({
  version: fc.constant(2 as const),
  recordedBy: fc.option(
    fc.record({
      name: fc.constant('shell-cassette'),
      version: genSemver,
    }),
    { nil: null },
  ),
  recordings: fc.array(genRecording, { maxLength: 5 }),
})

describe('serialize round-trip property', () => {
  test('serialize(deserialize(serialize(x))) === serialize(x)', () => {
    fc.assert(
      fc.property(genCassetteFile, (cf) => {
        const s1 = serialize(cf)
        const cf2 = deserialize(s1)
        const s2 = serialize(cf2)
        expect(s2).toBe(s1)
      }),
      { numRuns: 100 },
    )
  })
})
