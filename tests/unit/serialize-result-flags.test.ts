import { describe, expect, test } from 'vitest'
import { deserialize, serialize } from '../../src/serialize.js'
import type { CassetteFile, Recording } from '../../src/types.js'

const recording = (overrides: Partial<Recording['result']> = {}): Recording => ({
  call: { command: 'cmd', args: [], cwd: null, env: {}, stdin: null },
  result: {
    stdoutLines: [''],
    stderrLines: [''],
    allLines: null,
    exitCode: 0,
    signal: null,
    durationMs: 1,
    aborted: false,
    ...overrides,
  },
  redactions: [],
  suppressed: [],
})

const wrap = (rec: Recording): CassetteFile => ({
  version: 2,
  recordedBy: null,
  recordings: [rec],
})

describe('serialize: optional Result flag fields', () => {
  test('emits all five flag fields when defined', () => {
    const json = serialize(
      wrap(
        recording({
          failed: true,
          timedOut: true,
          isMaxBuffer: true,
          isForcefullyTerminated: true,
          isGracefullyCanceled: true,
        }),
      ),
    )
    const parsed = JSON.parse(json)
    const r = parsed.recordings[0].result
    expect(r.failed).toBe(true)
    expect(r.timedOut).toBe(true)
    expect(r.isMaxBuffer).toBe(true)
    expect(r.isForcefullyTerminated).toBe(true)
    expect(r.isGracefullyCanceled).toBe(true)
  })

  test('omits fields that are undefined on the in-memory recording', () => {
    const json = serialize(wrap(recording()))
    const parsed = JSON.parse(json)
    const r = parsed.recordings[0].result
    expect('failed' in r).toBe(false)
    expect('timedOut' in r).toBe(false)
    expect('isMaxBuffer' in r).toBe(false)
    expect('isForcefullyTerminated' in r).toBe(false)
    expect('isGracefullyCanceled' in r).toBe(false)
  })

  test('round-trips: serialize then deserialize preserves set fields', () => {
    const original = wrap(recording({ failed: true, timedOut: false, isMaxBuffer: true }))
    const round = deserialize(serialize(original))
    const r = round.recordings[0].result
    expect(r.failed).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.isMaxBuffer).toBe(true)
    expect(r.isForcefullyTerminated).toBeUndefined()
    expect(r.isGracefullyCanceled).toBeUndefined()
  })

  test('canonical key order: flags appear after `aborted`', () => {
    const json = serialize(wrap(recording({ failed: true, timedOut: true })))
    const resultText = json.slice(json.indexOf('"result"'), json.indexOf('"_redactions"'))
    expect(resultText.indexOf('"aborted"')).toBeLessThan(resultText.indexOf('"failed"'))
    expect(resultText.indexOf('"failed"')).toBeLessThan(resultText.indexOf('"timedOut"'))
  })
})
