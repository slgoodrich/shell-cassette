import { describe, expect, test } from 'vitest'
import { buildSummary, parseShowArgs } from '../../src/cli-show.js'
import type { CassetteFile } from '../../src/types.js'
import { makeRecording } from '../helpers/recording.js'

describe('parseShowArgs', () => {
  test('default flags', () => {
    const f = parseShowArgs(['./fixture.json'])
    expect(f).toMatchObject({
      path: './fixture.json',
      json: false,
      full: false,
      lines: 5,
      colorOverride: 'auto',
      help: false,
    })
  })

  test('--json flag', () => {
    expect(parseShowArgs(['./f.json', '--json']).json).toBe(true)
  })

  test('--full flag', () => {
    expect(parseShowArgs(['./f.json', '--full']).full).toBe(true)
  })

  test('--lines=N parsed', () => {
    expect(parseShowArgs(['./f.json', '--lines=20']).lines).toBe(20)
  })

  test('--lines N (space-separated) parsed', () => {
    expect(parseShowArgs(['./f.json', '--lines', '15']).lines).toBe(15)
  })

  test('--no-color and --color=always', () => {
    expect(parseShowArgs(['./f.json', '--no-color']).colorOverride).toBe('never')
    expect(parseShowArgs(['./f.json', '--color=always']).colorOverride).toBe('always')
  })

  test('--help', () => {
    expect(parseShowArgs(['--help']).help).toBe(true)
  })

  test('throws on unknown flag', () => {
    expect(() => parseShowArgs(['./f.json', '--bogus'])).toThrow(/unknown flag/)
  })

  test('throws when more than one path provided', () => {
    expect(() => parseShowArgs(['a.json', 'b.json'])).toThrow(/exactly one path/)
  })
})

describe('buildSummary', () => {
  test('aggregates redactions by rule and source across recordings', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: { name: 'shell-cassette', version: '0.5.0' },
      recordings: [
        makeRecording({
          call: { command: 'gh', args: ['x'], cwd: null, env: {}, stdin: null },
          result: { durationMs: 50 },
          redactions: [
            { rule: 'github-pat-classic', source: 'stdout', count: 2 },
            { rule: 'openai-api-key', source: 'env', count: 1 },
          ],
        }),
        makeRecording({
          call: { command: 'gh', args: ['x'], cwd: null, env: {}, stdin: null },
          result: { durationMs: 50 },
          redactions: [{ rule: 'github-pat-classic', source: 'args', count: 1 }],
        }),
      ],
    }
    const summary = buildSummary(cassette, '/tmp/x.json', 1234)
    expect(summary).toMatchObject({
      path: '/tmp/x.json',
      fileSize: 1234,
      version: 2,
      recordedBy: { name: 'shell-cassette', version: '0.5.0' },
      recordingCount: 2,
      redactions: {
        total: 4,
        byRule: { 'github-pat-classic': 3, 'openai-api-key': 1 },
        bySource: { stdout: 2, env: 1, args: 1 },
      },
    })
  })

  test('v1 cassette: recordedBy null, redactions zero', () => {
    const cassette: CassetteFile = {
      version: 1,
      recordedBy: null,
      recordings: [makeRecording()],
    }
    const summary = buildSummary(cassette, '/tmp/v1.json', 100)
    expect(summary.recordedBy).toBeNull()
    expect(summary.redactions.total).toBe(0)
  })
})
