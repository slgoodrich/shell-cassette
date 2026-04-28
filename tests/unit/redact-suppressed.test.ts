import { describe, expect, test } from 'vitest'
import { collectSuppressedHashes, matchHash, runPipeline } from '../../src/redact-pipeline.js'
import type { CassetteFile, RedactConfig } from '../../src/types.js'
import { makeRecording } from '../helpers/recording.js'

const minimalConfig: RedactConfig = {
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

describe('runPipeline: suppressedHashes', () => {
  // GitHub PAT classic shape: ghp_ + 36 alphanumerics
  const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
  const value = `prefix ${pat} suffix`

  test('without suppressedHashes, the bundled rule fires and replaces the PAT', () => {
    const out = runPipeline({ source: 'stdout', value }, minimalConfig, { counted: false })
    expect(out.output).not.toContain(pat)
    expect(out.output).toContain('<redacted:stdout:github-pat-classic>')
    expect(out.entries.length).toBe(1)
  })

  test('with the PAT hash in suppressedHashes, the bundled rule SKIPS that match', () => {
    const out = runPipeline({ source: 'stdout', value }, minimalConfig, {
      counted: false,
      suppressedHashes: new Set([matchHash(pat)]),
    })
    expect(out.output).toBe(value) // unchanged
    expect(out.entries.length).toBe(0) // no entries emitted
  })

  test('a different hash in suppressedHashes does NOT skip an unrelated match', () => {
    const out = runPipeline({ source: 'stdout', value }, minimalConfig, {
      counted: false,
      suppressedHashes: new Set([matchHash('something-else')]),
    })
    expect(out.output).not.toContain(pat)
    expect(out.entries.length).toBe(1)
  })

  test('counted mode + suppressedHashes: counter is NOT incremented for skipped matches', () => {
    const counters = new Map<string, number>()
    counters.set('stdout:github-pat-classic', 5) // pretend ceiling was 5
    runPipeline({ source: 'stdout', value }, minimalConfig, {
      counted: true,
      counters,
      suppressedHashes: new Set([matchHash(pat)]),
    })
    expect(counters.get('stdout:github-pat-classic')).toBe(5) // unchanged
  })
})

describe('collectSuppressedHashes', () => {
  test('returns empty set for cassette with no _suppressed entries', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [makeRecording()],
    }
    expect(collectSuppressedHashes(file).size).toBe(0)
  })

  test('collects hashes across all recordings', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          suppressed: [
            { source: 'stdout', rule: 'r1', position: '1:0', matchHash: 'sha256:aaa' },
            { source: 'stdout', rule: 'r2', position: '2:0', matchHash: 'sha256:bbb' },
          ],
        }),
        makeRecording({
          suppressed: [{ source: 'args', rule: 'r3', position: '0:0', matchHash: 'sha256:ccc' }],
        }),
      ],
    }
    const set = collectSuppressedHashes(file)
    expect(set.size).toBe(3)
    expect(set.has('sha256:aaa')).toBe(true)
    expect(set.has('sha256:bbb')).toBe(true)
    expect(set.has('sha256:ccc')).toBe(true)
  })

  test('deduplicates the same hash appearing in multiple recordings', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          suppressed: [{ source: 'stdout', rule: 'r', position: '1:0', matchHash: 'sha256:dup' }],
        }),
        makeRecording({
          suppressed: [{ source: 'args', rule: 'r', position: '0:0', matchHash: 'sha256:dup' }],
        }),
      ],
    }
    const set = collectSuppressedHashes(file)
    expect(set.size).toBe(1)
  })
})
