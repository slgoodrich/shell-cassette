import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type Reader, setReader } from '../../src/cli-prompt.js'
import type { Finding, ReviewState } from '../../src/cli-review.js'
import { applyAction, preScan, runReview } from '../../src/cli-review.js'
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
  return { findings, cursor: 0, history: [], decisions: new Map(), step: 'reviewing' }
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

  test('back at start (empty history) is a no-op', () => {
    const state = mkState([mkFinding('a', 0)])
    const next = applyAction(state, { kind: 'back' })
    expect(next.cursor).toBe(0)
    expect(next.step).toBe('reviewing')
  })

  test('back undoes a delete fully (rewinds the multi-step skip and clears all decisions)', () => {
    let state = mkState([mkFinding('a', 0), mkFinding('b', 0), mkFinding('c', 1)])
    state = applyAction(state, { kind: 'delete' })
    // Sanity: delete on `a` skipped `b` (same recording), cursor at `c`.
    expect(state.cursor).toBe(2)
    expect(state.decisions.get('a')).toEqual({ kind: 'delete', recordingIndex: 0 })

    state = applyAction(state, { kind: 'back' })
    // Cursor returns to 0 (where the user actually was when they pressed delete).
    expect(state.cursor).toBe(0)
    // The delete decision is gone — user must re-decide. b never had a
    // decision, but verifying both are clear ensures the unwound range is
    // correctly cleared.
    expect(state.decisions.has('a')).toBe(false)
    expect(state.decisions.has('b')).toBe(false)
  })

  test('back from confirming returns to reviewing at the last decided finding', () => {
    let state = mkState([mkFinding('a', 0), mkFinding('b', 0)])
    state = applyAction(state, { kind: 'accept' }) // cursor 1
    state = applyAction(state, { kind: 'accept' }) // cursor 2, step = confirming
    expect(state.step).toBe('confirming')

    state = applyAction(state, { kind: 'back' })
    expect(state.step).toBe('reviewing')
    expect(state.cursor).toBe(1)
    // Last decision (b) is unwound; the earlier (a) is still in.
    expect(state.decisions.has('b')).toBe(false)
    expect(state.decisions.get('a')).toEqual({ kind: 'accept' })
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

describe('runReview --json', () => {
  let tmp: string
  let outBuf: string[]
  let errBuf: string[]
  const origStdout = process.stdout.write.bind(process.stdout)
  const origStderr = process.stderr.write.bind(process.stderr)

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-review-json-'))
    outBuf = []
    errBuf = []
    process.stdout.write = ((s: string) => {
      outBuf.push(s)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((s: string) => {
      errBuf.push(s)
      return true
    }) as typeof process.stderr.write
  })
  afterEach(async () => {
    process.stdout.write = origStdout
    process.stderr.write = origStderr
    await rm(tmp, { recursive: true, force: true })
  })

  test('emits reviewVersion: 1 with summary and findings (default-safe match)', async () => {
    const PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: null,
      recordings: [
        {
          call: { command: 'gh', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [`Token: ${PAT}`],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          _redactions: [],
        },
      ],
    }
    const fixturePath = path.join(tmp, 'fix.json')
    await writeFile(fixturePath, `${JSON.stringify(cassette, null, 2)}\n`)

    const exit = await runReview([fixturePath, '--json', '--no-color'])
    expect(exit).toBe(0)
    const out = JSON.parse(outBuf.join(''))
    expect(out.reviewVersion).toBe(1)
    expect(out.summary.totalFindings).toBe(1)
    expect(out.findings).toHaveLength(1)
    // default-safe: match field absent
    expect(out.findings[0].match).toBeUndefined()
    expect(out.findings[0].matchHash).toMatch(/^sha256:/)
    expect(out.findings[0].matchPreview).toMatch(/^ghp_/)
  })

  test('--include-match adds raw match field', async () => {
    const PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: null,
      recordings: [
        {
          call: { command: 'gh', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [PAT],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          _redactions: [],
        },
      ],
    }
    const fixturePath = path.join(tmp, 'fix.json')
    await writeFile(fixturePath, `${JSON.stringify(cassette, null, 2)}\n`)

    const exit = await runReview([fixturePath, '--json', '--include-match', '--no-color'])
    expect(exit).toBe(0)
    const out = JSON.parse(outBuf.join(''))
    expect(out.findings[0].match).toBe(PAT)
  })

  test('returns 2 on missing path', async () => {
    const exit = await runReview([])
    expect(exit).toBe(2)
    expect(errBuf.join('')).toContain('review requires a path')
  })

  test('--help returns 0', async () => {
    const exit = await runReview(['--help'])
    expect(exit).toBe(0)
    expect(outBuf.join('')).toContain('Usage:')
  })
})

describe('runReview interactive (driven via fake reader)', () => {
  let tmp: string
  let outBuf: string[]
  const origStdout = process.stdout.write.bind(process.stdout)

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-review-int-'))
    outBuf = []
    // renderFinding emits the match preview, hash, and surrounding context lines —
    // for a fixture with a real-looking PAT, that means secrets land in the
    // vitest reporter unless stdout is captured.
    process.stdout.write = ((s: string) => {
      outBuf.push(s)
      return true
    }) as typeof process.stdout.write
  })
  afterEach(async () => {
    process.stdout.write = origStdout
    setReader(null)
    await rm(tmp, { recursive: true, force: true })
  })

  function makeReader(answers: string[]): Reader {
    const queue = [...answers]
    return {
      question: async () => {
        const next = queue.shift()
        if (next === undefined) return ''
        return next
      },
      close: () => {},
    }
  }

  test('clean cassette (no findings) exits 0 immediately', async () => {
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: null,
      recordings: [
        {
          call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: ['hi'],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          _redactions: [],
        },
      ],
    }
    const fixturePath = path.join(tmp, 'clean.json')
    await writeFile(fixturePath, `${JSON.stringify(cassette, null, 2)}\n`)

    const exit = await runReview([fixturePath, '--no-color'])
    expect(exit).toBe(0)
  })

  test('accept-all-then-confirm writes redacted cassette', async () => {
    const PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: null,
      recordings: [
        {
          call: { command: 'gh', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [`A: ${PAT}`],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          _redactions: [],
        },
      ],
    }
    const fixturePath = path.join(tmp, 'dirty.json')
    await writeFile(fixturePath, `${JSON.stringify(cassette, null, 2)}\n`)

    setReader(makeReader(['a', 'y'])) // accept finding 1, then confirm yes
    const exit = await runReview([fixturePath, '--no-color'])
    expect(exit).toBe(0)
    const after = await readFile(fixturePath, 'utf8')
    expect(JSON.parse(after).recordings[0].result.stdoutLines[0]).toContain(
      '<redacted:stdout:github-pat-classic',
    )
    // Sanity check: stdout was actually captured (renderFinding ran).
    expect(outBuf.join('')).toContain('[Finding')
  })

  test('quit discards decisions; cassette unchanged', async () => {
    const PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: null,
      recordings: [
        {
          call: { command: 'gh', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [`A: ${PAT}`],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
          _redactions: [],
        },
      ],
    }
    const fixturePath = path.join(tmp, 'quit.json')
    const before = `${JSON.stringify(cassette, null, 2)}\n`
    await writeFile(fixturePath, before)

    setReader(makeReader(['q'])) // quit on the first finding
    const exit = await runReview([fixturePath, '--no-color'])
    expect(exit).toBe(0)
    const after = await readFile(fixturePath, 'utf8')
    expect(after).toBe(before)
  })
})
