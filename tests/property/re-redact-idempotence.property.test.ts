import path from 'node:path'
import * as fc from 'fast-check'
import { describe, test } from 'vitest'
import { reRedactOne } from '../../src/cli-re-redact.js'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { writeCassetteFile } from '../../src/io.js'
import { serialize } from '../../src/serialize.js'
import type { CassetteFile, Recording } from '../../src/types.js'
import { SAMPLE_GITHUB_PAT_CLASSIC } from '../helpers/credential-fixtures.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const valueArb = fc.oneof(
  fc.string({ maxLength: 30 }).filter((s) => !s.includes('\n')),
  fc.constant(SAMPLE_GITHUB_PAT_CLASSIC),
  fc.constant(`Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`),
)

const callArb = fc.record({
  command: fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => !s.includes('\n') && s.trim().length > 0),
  args: fc.array(valueArb, { maxLength: 4 }),
  cwd: fc.option(
    fc.string({ minLength: 0, maxLength: 20 }).filter((s) => !s.includes('\n')),
    { nil: null },
  ),
  env: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[A-Z_]+$/.test(s)),
    valueArb,
    { maxKeys: 3 },
  ),
  stdin: fc.constant(null),
})

const resultArb = fc.record({
  stdoutLines: fc.array(valueArb, { maxLength: 3 }),
  stderrLines: fc.array(valueArb, { maxLength: 3 }),
  allLines: fc.option(fc.array(valueArb, { maxLength: 3 }), { nil: null }),
  exitCode: fc.integer({ min: 0, max: 255 }),
  signal: fc.option(fc.constantFrom('SIGTERM', 'SIGINT'), { nil: null }),
  durationMs: fc.integer({ min: 0, max: 10_000 }),
  aborted: fc.boolean(),
})

const recordingArb: fc.Arbitrary<Recording> = fc.record({
  call: callArb,
  result: resultArb,
  redactions: fc.constant([]),
})

const cassetteArb: fc.Arbitrary<CassetteFile> = fc.record({
  version: fc.constant(2 as const),
  recordedBy: fc.constant(null),
  recordings: fc.array(recordingArb, { minLength: 1, maxLength: 3 }),
})

describe('re-redact: full-cassette idempotence', () => {
  const tmp = useTmpDir('shell-cassette-rr-prop-')

  test('reRedactOne(reRedactOne(C)) reports zero new redactions on the second pass', async () => {
    await fc.assert(
      fc.asyncProperty(cassetteArb, async (cassette) => {
        const cassettePath = path.join(tmp.ref(), `c-${Math.random().toString(36).slice(2)}.json`)
        await writeCassetteFile(cassettePath, serialize(cassette))

        await reRedactOne(cassettePath, DEFAULT_CONFIG.redact, false)
        const second = await reRedactOne(cassettePath, DEFAULT_CONFIG.redact, false)

        return second.newRedactions === 0
      }),
      { numRuns: 20 },
    )
  })

  test('dry-run twice reports identical newRedactions counts', async () => {
    await fc.assert(
      fc.asyncProperty(cassetteArb, async (cassette) => {
        const cassettePath = path.join(tmp.ref(), `d-${Math.random().toString(36).slice(2)}.json`)
        await writeCassetteFile(cassettePath, serialize(cassette))

        const first = await reRedactOne(cassettePath, DEFAULT_CONFIG.redact, true)
        const second = await reRedactOne(cassettePath, DEFAULT_CONFIG.redact, true)

        return first.newRedactions === second.newRedactions
      }),
      { numRuns: 20 },
    )
  })
})
