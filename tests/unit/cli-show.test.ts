import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildSummary, parseShowArgs, runShow } from '../../src/cli-show.js'
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

describe('runShow --json', () => {
  let tmp: string
  let captured: string[]
  const origWrite = process.stdout.write.bind(process.stdout)

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-show-'))
    captured = []
    process.stdout.write = ((s: string) => {
      captured.push(s)
      return true
    }) as typeof process.stdout.write
  })
  afterEach(async () => {
    process.stdout.write = origWrite
    await rm(tmp, { recursive: true, force: true })
  })

  test('emits showVersion: 1 with summary and full cassette', async () => {
    const cassette = {
      version: 2,
      _warning: '',
      _recorded_by: { name: 'shell-cassette', version: '0.5.0' },
      recordings: [
        {
          call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: ['hi'],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 5,
            aborted: false,
          },
          _redactions: [{ rule: 'r1', source: 'stdout', count: 1 }],
        },
      ],
    }
    const fixturePath = path.join(tmp, 'fix.json')
    await writeFile(fixturePath, `${JSON.stringify(cassette, null, 2)}\n`)

    const exit = await runShow([fixturePath, '--json', '--no-color'])
    expect(exit).toBe(0)
    const out = JSON.parse(captured.join(''))
    expect(out.showVersion).toBe(1)
    expect(out.summary.path).toBe(fixturePath)
    expect(out.summary.recordingCount).toBe(1)
    expect(out.summary.redactions.total).toBe(1)
    expect(out.cassette.recordings).toHaveLength(1)
  })

  test('returns 2 on missing path', async () => {
    const exit = await runShow([])
    expect(exit).toBe(2)
  })

  test('returns 2 on nonexistent file', async () => {
    const exit = await runShow([path.join(tmp, 'missing.json'), '--json'])
    expect(exit).toBe(2)
  })

  test('--help returns 0', async () => {
    const exit = await runShow(['--help'])
    expect(exit).toBe(0)
  })
})
