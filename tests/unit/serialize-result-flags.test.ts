import { describe, expect, test } from 'vitest'
import { deserialize, serialize } from '../../src/serialize.js'
import type { CassetteFile } from '../../src/types.js'
import { makeRecording } from '../helpers/recording.js'

describe('serialize: optional Result flag fields', () => {
  test('emits all five flag fields when defined', () => {
    const rec = makeRecording({
      result: {
        failed: true,
        timedOut: true,
        isMaxBuffer: true,
        isForcefullyTerminated: true,
        isGracefullyCanceled: true,
      },
    })
    const cassette: CassetteFile = { version: 2, recordedBy: null, recordings: [rec] }
    const json = serialize(cassette)
    const parsed = JSON.parse(json)
    const r = parsed.recordings[0].result
    expect(r.failed).toBe(true)
    expect(r.timedOut).toBe(true)
    expect(r.isMaxBuffer).toBe(true)
    expect(r.isForcefullyTerminated).toBe(true)
    expect(r.isGracefullyCanceled).toBe(true)
  })

  test('omits fields that are undefined on the in-memory recording', () => {
    const rec = makeRecording()
    const cassette: CassetteFile = { version: 2, recordedBy: null, recordings: [rec] }
    const json = serialize(cassette)
    const parsed = JSON.parse(json)
    const r = parsed.recordings[0].result
    expect('failed' in r).toBe(false)
    expect('timedOut' in r).toBe(false)
    expect('isMaxBuffer' in r).toBe(false)
    expect('isForcefullyTerminated' in r).toBe(false)
    expect('isGracefullyCanceled' in r).toBe(false)
  })

  test('round-trips: serialize then deserialize preserves set fields', () => {
    const rec = makeRecording({ result: { failed: true, timedOut: false, isMaxBuffer: true } })
    const original: CassetteFile = { version: 2, recordedBy: null, recordings: [rec] }
    const round = deserialize(serialize(original))
    const r = round.recordings[0].result
    expect(r.failed).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.isMaxBuffer).toBe(true)
    expect(r.isForcefullyTerminated).toBeUndefined()
    expect(r.isGracefullyCanceled).toBeUndefined()
  })

  test('canonical key order: flags appear after `aborted`', () => {
    const rec = makeRecording({ result: { failed: true, timedOut: true } })
    const cassette: CassetteFile = { version: 2, recordedBy: null, recordings: [rec] }
    const json = serialize(cassette)
    const resultText = json.slice(json.indexOf('"result"'), json.indexOf('"_redactions"'))
    expect(resultText.indexOf('"aborted"')).toBeLessThan(resultText.indexOf('"failed"'))
    expect(resultText.indexOf('"failed"')).toBeLessThan(resultText.indexOf('"timedOut"'))
  })
})
