import { describe, expect, test } from 'vitest'
import type { Finding, ReviewState } from '../../src/cli-review.js'
import { applyAction, preScan } from '../../src/cli-review.js'
import { ENV_KEY_MATCH_RULE, matchHash } from '../../src/redact-pipeline.js'
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

describe('preScan', () => {
  test('returns empty array when no findings', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [makeRecording({ result: { stdoutLines: ['hello'] } })],
    }
    expect(preScan(cassette, minimalConfig)).toEqual([])
  })

  test('finds GitHub PAT in stdout', () => {
    const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [makeRecording({ result: { stdoutLines: [`Token: ${pat}`] } })],
    }
    const findings = preScan(cassette, minimalConfig)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      recordingIndex: 0,
      source: 'stdout',
      rule: 'github-pat-classic',
      matchLength: pat.length,
    })
    expect(findings[0]?.matchHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(findings[0]?.id).toBe('rec0-stdout-1:7-github-pat-classic')
  })

  test('skips matches whose hash is in any recording.suppressed', () => {
    const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const hash = matchHash(pat)
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          result: { stdoutLines: [pat] },
          suppressed: [
            { source: 'stdout', rule: 'github-pat-classic', position: '1:0', matchHash: hash },
          ],
        }),
      ],
    }
    expect(preScan(cassette, minimalConfig)).toEqual([])
  })

  test('suppression skip is hash-based and works across recordings (position-independent)', () => {
    const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const hash = matchHash(pat)
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        // Recording 0 holds the suppressed entry but doesn't contain the match.
        makeRecording({
          suppressed: [
            { source: 'stdout', rule: 'github-pat-classic', position: '99:99', matchHash: hash },
          ],
        }),
        // Recording 1 contains the same secret at a different position; no
        // suppressed entry of its own. Should still be skipped via the
        // cassette-wide hash collection.
        makeRecording({ result: { stdoutLines: [`prefix ${pat}`] } }),
      ],
    }
    expect(preScan(cassette, minimalConfig)).toEqual([])
  })

  test('captures context lines around the match', () => {
    const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          result: { stdoutLines: ['line A', 'line B', `Token: ${pat}`, 'line D', 'line E'] },
        }),
      ],
    }
    const findings = preScan(cassette, minimalConfig)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.context).toMatchObject({
      lineNumber: 3,
      before: ['line A', 'line B'],
      line: `Token: ${pat}`,
      after: ['line D', 'line E'],
    })
  })

  test('args matches use <argIndex>:<col> position', () => {
    const pat = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: {
            command: 'gh',
            args: ['login', '--token', pat],
            cwd: null,
            env: {},
            stdin: null,
          },
        }),
      ],
    }
    const findings = preScan(cassette, minimalConfig)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.position).toBe('2:0')
    expect(findings[0]?.id).toBe('rec0-args-2:0-github-pat-classic')
  })

  test('reports env-key-match for curated keys even without a regex hit', () => {
    // Opaque value with no bundled-pattern shape; key matches a configured
    // env-key substring. Mirrors cli-scan's env-key-match coverage so review
    // doesn't silently under-report relative to scan.
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: {
            command: 'gh',
            args: [],
            cwd: null,
            env: { MY_TOKEN: 'opaque-no-regex-shape' },
            stdin: null,
          },
        }),
      ],
    }
    const config: RedactConfig = { ...minimalConfig, envKeys: ['TOKEN'] }
    const findings = preScan(cassette, config)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      source: 'env',
      rule: ENV_KEY_MATCH_RULE,
      position: 'MY_TOKEN:0',
      match: 'opaque-no-regex-shape',
    })
    expect(findings[0]?.id).toBe(`rec0-env-MY_TOKEN:0-${ENV_KEY_MATCH_RULE}`)
  })

  test('env-key-match skips already-redacted placeholders', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: {
            command: 'gh',
            args: [],
            cwd: null,
            env: { MY_TOKEN: '<redacted:env:env-key-match:1>' },
            stdin: null,
          },
        }),
      ],
    }
    const config: RedactConfig = { ...minimalConfig, envKeys: ['TOKEN'] }
    expect(preScan(cassette, config)).toEqual([])
  })
})

function mkFinding(
  id: string,
  recordingIndex: number,
  source: 'stdout' | 'args' = 'stdout',
): Finding {
  return {
    id,
    recordingIndex,
    source,
    rule: 'github-pat-classic',
    match: 'ghp_xxx',
    matchHash: `sha256:${id}`,
    matchLength: 7,
    matchPreview: 'ghp_xxx',
    position: '1:0',
    context: { lineNumber: 1, before: [], line: 'ghp_xxx', after: [] },
  }
}

function mkState(findings: Finding[]): ReviewState {
  return { findings, cursor: 0, decisions: new Map(), step: 'reviewing' }
}

describe('applyAction', () => {
  test('accept advances cursor and records accept decision', () => {
    const state = mkState([mkFinding('a', 0), mkFinding('b', 0)])
    const next = applyAction(state, { kind: 'accept' })
    expect(next.cursor).toBe(1)
    expect(next.decisions.get('a')).toEqual({ kind: 'accept' })
    expect(next.step).toBe('reviewing')
  })

  test('skip records skip decision', () => {
    const state = mkState([mkFinding('a', 0), mkFinding('b', 0)])
    const next = applyAction(state, { kind: 'skip' })
    expect(next.decisions.get('a')).toEqual({ kind: 'skip' })
    expect(next.cursor).toBe(1)
  })

  test('replace records replace decision with user value', () => {
    const state = mkState([mkFinding('a', 0)])
    const next = applyAction(state, { kind: 'replace', with: 'CUSTOM' })
    expect(next.decisions.get('a')).toEqual({ kind: 'replace', with: 'CUSTOM' })
  })

  test('delete records delete decision and skips remaining findings in same recording', () => {
    const state = mkState([mkFinding('a', 0), mkFinding('b', 0), mkFinding('c', 1)])
    const next = applyAction(state, { kind: 'delete' })
    expect(next.decisions.get('a')).toEqual({ kind: 'delete', recordingIndex: 0 })
    // 'b' is in the same recording (0), so cursor jumps past it to 'c' (recording 1)
    expect(next.cursor).toBe(2)
  })

  test('back decrements cursor and removes prior decision (user must re-decide)', () => {
    let state = mkState([mkFinding('a', 0), mkFinding('b', 0)])
    state = applyAction(state, { kind: 'accept' }) // cursor 1, decision 'a' = accept
    expect(state.cursor).toBe(1)
    state = applyAction(state, { kind: 'back' })
    expect(state.cursor).toBe(0)
    expect(state.decisions.has('a')).toBe(false)
  })

  test('back at cursor 0 is a no-op (still reviewing, cursor 0)', () => {
    const state = mkState([mkFinding('a', 0)])
    const next = applyAction(state, { kind: 'back' })
    expect(next.cursor).toBe(0)
    expect(next.step).toBe('reviewing')
  })

  test('reaching end of findings transitions to confirming', () => {
    let state = mkState([mkFinding('a', 0)])
    state = applyAction(state, { kind: 'accept' }) // cursor 1, past end
    expect(state.step).toBe('confirming')
  })

  test('quit transitions to aborted', () => {
    const state = mkState([mkFinding('a', 0)])
    const next = applyAction(state, { kind: 'quit' })
    expect(next.step).toBe('aborted')
  })

  test('apply transitions to done with decisions intact', () => {
    let state = mkState([mkFinding('a', 0)])
    state = applyAction(state, { kind: 'accept' }) // step = confirming
    state = applyAction(state, { kind: 'apply' })
    expect(state.step).toBe('done')
    expect(state.decisions.size).toBe(1)
  })

  test('discard transitions to done with empty decisions', () => {
    let state = mkState([mkFinding('a', 0)])
    state = applyAction(state, { kind: 'accept' }) // step = confirming
    state = applyAction(state, { kind: 'discard' })
    expect(state.step).toBe('done')
    expect(state.decisions.size).toBe(0)
  })
})
