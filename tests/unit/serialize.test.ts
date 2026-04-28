import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { BinaryOutputError, CassetteCorruptError } from '../../src/errors.js'
import { deserialize, serialize } from '../../src/serialize.js'
import type { CassetteFile } from '../../src/types.js'
import { makeRecording } from '../helpers/recording.js'

const fixture = (name: string) => readFileSync(`tests/fixtures/cassettes/${name}.json`, 'utf8')

describe('deserialize', () => {
  test('parses valid v1 empty cassette', () => {
    const result = deserialize(fixture('valid-v1-empty'))
    expect(result.version).toBe(1)
    expect(result.recordings).toEqual([])
  })

  test('parses valid v1 single recording; legacy fixture has no allLines so it normalizes to null', () => {
    const result = deserialize(fixture('valid-v1-single'))
    expect(result.recordings).toHaveLength(1)
    expect(result.recordings[0]?.call.command).toBe('git')
    expect(result.recordings[0]?.result.exitCode).toBe(0)
    expect(result.recordings[0]?.result.allLines).toBeNull()
  })

  test('throws CassetteCorruptError on missing version', () => {
    expect(() => deserialize(fixture('no-version'))).toThrow(CassetteCorruptError)
  })

  test('throws CassetteCorruptError on unknown version', () => {
    expect(() => deserialize(fixture('unknown-version'))).toThrow(CassetteCorruptError)
  })

  test('throws CassetteCorruptError on malformed JSON', () => {
    expect(() => deserialize(fixture('malformed'))).toThrow(CassetteCorruptError)
  })
})

describe('serialize', () => {
  test('round-trip for single recording', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: { command: 'echo', args: ['hello'], cwd: null, env: {}, stdin: null },
          result: { stdoutLines: ['hello', ''], stderrLines: [''], durationMs: 5 },
        }),
      ],
    }
    const json = serialize(file)
    const round = deserialize(json)
    expect(round).toEqual(file)
  })

  test('output uses 2-space indent and canonical key order', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [],
    }
    const json = serialize(file)
    expect(json.startsWith('{\n  "version": 2')).toBe(true)
  })

  test('preserves trailing newline via empty string at end of stdoutLines', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: { command: 'x', args: [], cwd: null, env: {}, stdin: null },
          result: { stdoutLines: ['line1', 'line2', ''], stderrLines: [''], durationMs: 1 },
        }),
      ],
    }
    const round = deserialize(serialize(file))
    expect(round.recordings[0]?.result.stdoutLines).toEqual(['line1', 'line2', ''])
  })

  test('round-trip preserves aborted: true', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: { command: 'sleep', args: ['10'], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [''],
            stderrLines: [''],
            exitCode: 1,
            signal: 'SIGTERM',
            durationMs: 42,
            aborted: true,
          },
        }),
      ],
    }
    const round = deserialize(serialize(file))
    expect(round.recordings[0]?.result.aborted).toBe(true)
  })

  test('legacy cassette without aborted field deserializes to aborted: false', () => {
    const legacyJson = JSON.stringify({
      version: 1,
      recordings: [
        {
          call: { command: 'echo', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [''],
            stderrLines: [''],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            // aborted intentionally missing
          },
        },
      ],
    })
    const round = deserialize(legacyJson)
    expect(round.recordings[0]?.result.aborted).toBe(false)
  })

  test('round-trip preserves allLines when populated', () => {
    const file: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: { command: 'x', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: ['out', ''],
            stderrLines: ['err', ''],
            allLines: ['out', 'err', ''],
            durationMs: 1,
          },
        }),
      ],
    }
    const round = deserialize(serialize(file))
    expect(round.recordings[0]?.result.allLines).toEqual(['out', 'err', ''])
  })

  test('throws BinaryOutputError if attempting to serialize non-string in stdoutLines', () => {
    const bad = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({
          call: { command: 'x', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [Buffer.from([0xff, 0xfe]) as unknown as string],
            stderrLines: [''],
            durationMs: 1,
          },
        }),
      ],
    } as CassetteFile
    expect(() => serialize(bad)).toThrow(BinaryOutputError)
  })
})
