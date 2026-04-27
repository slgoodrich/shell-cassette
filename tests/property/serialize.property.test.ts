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

const genRecording: fc.Arbitrary<Recording> = fc.record({
  call: genCall,
  result: genResult,
})

const genCassetteFile: fc.Arbitrary<CassetteFile> = fc.record({
  version: fc.constant(1 as const),
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
