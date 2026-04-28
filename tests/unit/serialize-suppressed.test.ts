import { describe, expect, test } from 'vitest'
import { deserialize, serialize } from '../../src/serialize.js'
import type { CassetteFile, SuppressedEntry } from '../../src/types.js'
import { makeRecording } from '../helpers/recording.js'

describe('serialize/deserialize: _suppressed field', () => {
  const baseRecording = makeRecording({
    call: { command: 'gh', args: ['repo', 'view'], cwd: null, env: {}, stdin: null },
    result: { stdoutLines: ['ok'], durationMs: 100 },
  })

  test('serialize emits _suppressed when non-empty', () => {
    const suppressed: SuppressedEntry[] = [
      { source: 'stdout', rule: 'github-pat-classic', position: '1:5', matchHash: 'sha256:abc123' },
    ]
    const file: CassetteFile = {
      version: 2,
      recordedBy: { name: 'shell-cassette', version: '0.5.0' },
      recordings: [{ ...baseRecording, suppressed }],
    }
    const parsed = JSON.parse(serialize(file))
    expect(parsed.recordings[0]._suppressed).toEqual(suppressed)
  })

  test('serialize omits _suppressed when empty', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: { name: 'shell-cassette', version: '0.5.0' },
      recordings: [baseRecording],
    }
    const parsed = JSON.parse(serialize(file))
    expect('_suppressed' in parsed.recordings[0]).toBe(false)
  })

  test('deserialize defaults missing _suppressed to []', () => {
    const v04Json = JSON.stringify({
      version: 2,
      _recorded_by: { name: 'shell-cassette', version: '0.4.0' },
      recordings: [
        {
          call: baseRecording.call,
          result: baseRecording.result,
          _redactions: [],
        },
      ],
    })
    const file = deserialize(v04Json)
    expect(file.recordings[0].suppressed).toEqual([])
  })

  test('round-trip preserves non-empty _suppressed', () => {
    const suppressed: SuppressedEntry[] = [
      { source: 'args', rule: 'openai-api-key', position: '0:8', matchHash: 'sha256:xyz' },
      { source: 'stdout', rule: 'custom', position: '3:0', matchHash: 'sha256:def' },
    ]
    const file: CassetteFile = {
      version: 2,
      recordedBy: { name: 'shell-cassette', version: '0.5.0' },
      recordings: [{ ...baseRecording, suppressed }],
    }
    const round = deserialize(serialize(file))
    expect(round.recordings[0].suppressed).toEqual(suppressed)
  })
})
