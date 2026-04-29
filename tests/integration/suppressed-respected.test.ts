import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { reRedactOne } from '../../src/cli-re-redact.js'
import { preScan } from '../../src/cli-review.js'
import { collectSuppressedHashes, matchHash } from '../../src/redact-pipeline.js'
import { deserialize } from '../../src/serialize.js'
import type { RedactConfig } from '../../src/types.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const tmp = useTmpDir('shell-cassette-suppressed-')

const baseConfig: RedactConfig = {
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
  suppressLengthWarningKeys: [],
}

// Both PATs are exactly ghp_ + 36 alphanumerics = 40 chars (the
// github-pat-classic shape).
const PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
const OTHER_PAT = 'ghp_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'

function makeCassetteJson(opts: { stdoutLines: string[]; suppressedHashes: string[] }): string {
  const cassette = {
    version: 2,
    _warning: '',
    _recorded_by: { name: 'shell-cassette', version: '0.5.0' },
    recordings: [
      {
        call: { command: 'echo', args: [], cwd: null, env: {}, stdin: null },
        result: {
          stdoutLines: opts.stdoutLines,
          stderrLines: [],
          allLines: null,
          exitCode: 0,
          signal: null,
          durationMs: 0,
          aborted: false,
        },
        _redactions: [],
        _suppressed: opts.suppressedHashes.map((h) => ({
          source: 'stdout',
          rule: 'github-pat-classic',
          position: '1:0',
          matchHash: h,
        })),
      },
    ],
  }
  return `${JSON.stringify(cassette, null, 2)}\n`
}

describe('re-redact respects _suppressed', () => {
  test('a match whose hash is in _suppressed stays unflagged after re-redact', async () => {
    const cassettePath = path.join(tmp.ref(), 'fixture.json')
    await writeFile(
      cassettePath,
      makeCassetteJson({ stdoutLines: [PAT], suppressedHashes: [matchHash(PAT)] }),
    )

    const result = await reRedactOne(cassettePath, baseConfig, false)
    expect(result.modified).toBe(false)
    expect(result.newRedactions).toBe(0)

    const loaded = deserialize(await readFile(cassettePath, 'utf8'))
    expect(loaded.recordings[0]?.result.stdoutLines[0]).toBe(PAT)
    expect(loaded.recordings[0]?.suppressed).toHaveLength(1)
    expect(collectSuppressedHashes(loaded).has(matchHash(PAT))).toBe(true)
  })

  test('a match NOT in _suppressed still gets re-redacted normally', async () => {
    const cassettePath = path.join(tmp.ref(), 'fixture.json')
    await writeFile(
      cassettePath,
      makeCassetteJson({
        stdoutLines: [PAT, OTHER_PAT],
        suppressedHashes: [matchHash(PAT)],
      }),
    )

    const result = await reRedactOne(cassettePath, baseConfig, false)
    expect(result.modified).toBe(true)
    expect(result.newRedactions).toBe(1)

    const loaded = deserialize(await readFile(cassettePath, 'utf8'))
    expect(loaded.recordings[0]?.result.stdoutLines[0]).toBe(PAT) // skip held
    expect(loaded.recordings[0]?.result.stdoutLines[1]).toContain('<redacted:') // other got placeholder
  })
})

describe('review preScan respects _suppressed', () => {
  test('a match whose hash is in _suppressed is excluded from preScan findings', async () => {
    const cassettePath = path.join(tmp.ref(), 'fixture.json')
    await writeFile(
      cassettePath,
      makeCassetteJson({ stdoutLines: [PAT], suppressedHashes: [matchHash(PAT)] }),
    )

    const loaded = deserialize(await readFile(cassettePath, 'utf8'))
    expect(preScan(loaded, baseConfig)).toEqual([])
  })

  test('only the suppressed match is excluded; others still surface', async () => {
    const cassettePath = path.join(tmp.ref(), 'fixture.json')
    await writeFile(
      cassettePath,
      makeCassetteJson({
        stdoutLines: [PAT, OTHER_PAT],
        suppressedHashes: [matchHash(PAT)],
      }),
    )

    const loaded = deserialize(await readFile(cassettePath, 'utf8'))
    const findings = preScan(loaded, baseConfig)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.match).toBe(OTHER_PAT)
  })
})
