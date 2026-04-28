import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { reRedactOne } from '../../src/cli-re-redact.js'
import { collectSuppressedHashes, matchHash } from '../../src/redact-pipeline.js'
import { deserialize } from '../../src/serialize.js'
import type { RedactConfig } from '../../src/types.js'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-suppressed-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const baseConfig: RedactConfig = {
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

describe('re-redact respects _suppressed', () => {
  test('a match whose hash is in _suppressed stays unflagged after re-redact', async () => {
    const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const hash = matchHash(pat)
    const cassettePath = path.join(tmp, 'fixture.json')
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: { name: 'shell-cassette', version: '0.5.0' },
      recordings: [
        {
          call: { command: 'echo', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [pat],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          _redactions: [],
          _suppressed: [
            { source: 'stdout', rule: 'github-pat-classic', position: '1:0', matchHash: hash },
          ],
        },
      ],
    }
    await writeFile(cassettePath, `${JSON.stringify(cassette, null, 2)}\n`)

    const result = await reRedactOne(cassettePath, baseConfig, false)
    expect(result.modified).toBe(false)
    expect(result.newRedactions).toBe(0)

    const loaded = deserialize(await readFile(cassettePath, 'utf8'))
    expect(loaded.recordings[0]?.result.stdoutLines[0]).toBe(pat)
    expect(loaded.recordings[0]?.suppressed).toHaveLength(1)
    expect(collectSuppressedHashes(loaded).has(hash)).toBe(true)
  })

  test('a match NOT in _suppressed still gets re-redacted normally', async () => {
    const skippedPat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const otherPat = 'ghp_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
    const skippedHash = matchHash(skippedPat)
    const cassettePath = path.join(tmp, 'fixture.json')
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: { name: 'shell-cassette', version: '0.5.0' },
      recordings: [
        {
          call: { command: 'echo', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [skippedPat, otherPat],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          _redactions: [],
          _suppressed: [
            {
              source: 'stdout',
              rule: 'github-pat-classic',
              position: '1:0',
              matchHash: skippedHash,
            },
          ],
        },
      ],
    }
    await writeFile(cassettePath, `${JSON.stringify(cassette, null, 2)}\n`)

    const result = await reRedactOne(cassettePath, baseConfig, false)
    expect(result.modified).toBe(true)
    expect(result.newRedactions).toBe(1)

    const loaded = deserialize(await readFile(cassettePath, 'utf8'))
    expect(loaded.recordings[0]?.result.stdoutLines[0]).toBe(skippedPat) // skip held
    expect(loaded.recordings[0]?.result.stdoutLines[1]).toContain('<redacted:') // other got placeholder
  })
})
