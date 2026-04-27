import { describe, expect, test } from 'vitest'
import { CassetteCorruptError } from '../../src/errors.js'
import { deserialize, serialize } from '../../src/serialize.js'
import type { CassetteFile } from '../../src/types.js'

const minimalV2: CassetteFile = {
  version: 2,
  recordedBy: { name: 'shell-cassette', version: '0.4.0' },
  recordings: [
    {
      call: { command: 'node', args: ['-v'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: ['v18.0.0'],
        stderrLines: [],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 100,
        aborted: false,
      },
      redactions: [],
    },
  ],
}

describe('serialize v2', () => {
  test('emits version: 2 in JSON', () => {
    const out = serialize(minimalV2)
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed.version).toBe(2)
  })

  test('emits _recorded_by from file.recordedBy', () => {
    const out = serialize(minimalV2)
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed._recorded_by).toEqual({ name: 'shell-cassette', version: '0.4.0' })
  })

  test('emits null _recorded_by when file.recordedBy is null', () => {
    const out = serialize({ ...minimalV2, recordedBy: null })
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed._recorded_by).toBe(null)
  })

  test('emits per-recording _redactions array', () => {
    const baseRecording = minimalV2.recordings[0]
    if (!baseRecording) throw new Error('minimalV2 must have at least one recording')
    const file: CassetteFile = {
      ...minimalV2,
      recordings: [
        {
          ...baseRecording,
          redactions: [{ rule: 'github-pat-classic', source: 'env', count: 1 }],
        },
      ],
    }
    const out = serialize(file)
    const parsed = JSON.parse(out) as { recordings: Array<{ _redactions: unknown }> }
    expect(parsed.recordings[0]?._redactions).toEqual([
      { rule: 'github-pat-classic', source: 'env', count: 1 },
    ])
  })

  test('emits trailing newline', () => {
    const out = serialize(minimalV2)
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('deserialize v2', () => {
  test('round-trip preserves all fields', () => {
    const out = serialize(minimalV2)
    const parsed = deserialize(out)
    expect(parsed).toEqual(minimalV2)
  })

  test('handles missing _recorded_by (loads as null)', () => {
    const json = JSON.stringify({
      version: 2,
      recordings: [],
    })
    const parsed = deserialize(json)
    expect(parsed.recordedBy).toBe(null)
  })

  test('handles missing per-recording _redactions (loads as [])', () => {
    const json = JSON.stringify({
      version: 2,
      recordings: [
        {
          call: { command: 'node', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
        },
      ],
    })
    const parsed = deserialize(json)
    expect(parsed.recordings[0]?.redactions).toEqual([])
  })
})

describe('deserialize v1 (forward compat)', () => {
  test('v1 cassette loads with recordedBy: null and redactions: []', () => {
    const json = JSON.stringify({
      version: 1,
      recordings: [
        {
          call: { command: 'node', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
            aborted: false,
          },
        },
      ],
    })
    const parsed = deserialize(json)
    expect(parsed.version).toBe(1)
    expect(parsed.recordedBy).toBe(null)
    expect(parsed.recordings[0]?.redactions).toEqual([])
  })

  test('v1 cassette without aborted/allLines fields normalizes correctly', () => {
    const json = JSON.stringify({
      version: 1,
      recordings: [
        {
          call: { command: 'node', args: [], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: [],
            stderrLines: [],
            exitCode: 0,
            signal: null,
            durationMs: 0,
          },
        },
      ],
    })
    const parsed = deserialize(json)
    expect(parsed.recordings[0]?.result.aborted).toBe(false)
    expect(parsed.recordings[0]?.result.allLines).toBe(null)
  })
})

describe('deserialize: version rejection', () => {
  test('version 3 throws CassetteCorruptError', () => {
    const json = JSON.stringify({ version: 3, recordings: [] })
    expect(() => deserialize(json)).toThrow(CassetteCorruptError)
  })

  test('version 0 throws CassetteCorruptError', () => {
    const json = JSON.stringify({ version: 0, recordings: [] })
    expect(() => deserialize(json)).toThrow(CassetteCorruptError)
  })

  test('version "1" (string) throws CassetteCorruptError (must be numeric)', () => {
    const json = JSON.stringify({ version: '1', recordings: [] })
    expect(() => deserialize(json)).toThrow(CassetteCorruptError)
  })

  test('missing version field throws CassetteCorruptError', () => {
    const json = JSON.stringify({ recordings: [] })
    expect(() => deserialize(json)).toThrow(CassetteCorruptError)
  })

  test('malformed JSON throws CassetteCorruptError', () => {
    expect(() => deserialize('{not valid')).toThrow(CassetteCorruptError)
  })

  test('version 3 error message instructs to upgrade', () => {
    const json = JSON.stringify({ version: 3, recordings: [] })
    expect(() => deserialize(json)).toThrow(/upgrade/)
  })
})
