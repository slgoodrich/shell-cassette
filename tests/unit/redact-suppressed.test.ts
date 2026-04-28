import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { runPipeline } from '../../src/redact-pipeline.js'
import type { RedactConfig } from '../../src/types.js'

const minimalConfig: Readonly<RedactConfig> = Object.freeze({
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
})

const sha256 = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`

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
      suppressedHashes: new Set([sha256(pat)]),
    })
    expect(out.output).toBe(value) // unchanged
    expect(out.entries.length).toBe(0) // no entries emitted
  })

  test('a different hash in suppressedHashes does NOT skip an unrelated match', () => {
    const out = runPipeline({ source: 'stdout', value }, minimalConfig, {
      counted: false,
      suppressedHashes: new Set([sha256('something-else')]),
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
      suppressedHashes: new Set([sha256(pat)]),
    })
    expect(counters.get('stdout:github-pat-classic')).toBe(5) // unchanged
  })
})
