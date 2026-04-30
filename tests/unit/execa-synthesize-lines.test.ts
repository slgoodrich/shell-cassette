import type { Options } from 'execa'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import { makeRecording } from '../helpers/recording.js'
import { makeSession } from '../helpers/session.js'

// Mock execa BEFORE importing src/execa.ts so the top-level
// `await import('execa')` in src/execa.ts picks up the stub.
vi.mock('execa', () => ({
  execa: vi.fn(),
}))

const { execa: realExecaMock } = await import('execa')
const { execa } = await import('../../src/execa.js')

// Helper: pre-load a session with a recording whose stdoutLines/stderrLines
// have a known shape, replay against the wrapper, and return the synthesized
// result. The recording is keyed on `('cmd', [])` so any execa() call with
// the same command/args matches.
async function replayWithLines(
  options: Options,
  resultOverrides: Parameters<typeof makeRecording>[0] extends { result?: infer R } ? R : never,
): Promise<unknown> {
  const recording = makeRecording({
    call: { command: 'cmd', args: [], cwd: null, env: {}, stdin: null },
    result: resultOverrides,
  })
  const session = makeSession({
    loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
  })
  setActiveCassette(session)
  process.env.SHELL_CASSETTE_MODE = 'replay'

  return await execa('cmd', [], options)
}

describe('synthesize: lines option resolution', () => {
  beforeEach(() => {
    _resetForTesting()
    vi.mocked(realExecaMock).mockReset()
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    delete process.env.CI
  })

  afterEach(() => {
    _resetForTesting()
    clearActiveCassette()
  })

  // toLines() appends a trailing '' to mark array origin; synthesize strips
  // it on the way out. Recordings here use `[...lines, '']` to match what a
  // real recording would store.

  test('lines: true returns BOTH stdout AND stderr as arrays', async () => {
    const result = (await replayWithLines(
      { lines: true },
      { stdoutLines: ['a', 'b', ''], stderrLines: ['err', ''] },
    )) as { stdout: unknown; stderr: unknown }
    expect(result.stdout).toEqual(['a', 'b'])
    expect(result.stderr).toEqual(['err'])
  })

  test('lines: false returns both as strings', async () => {
    const result = (await replayWithLines(
      { lines: false },
      { stdoutLines: ['a', 'b'], stderrLines: ['err'] },
    )) as { stdout: unknown; stderr: unknown }
    expect(result.stdout).toBe('a\nb')
    expect(result.stderr).toBe('err')
  })

  test('lines undefined returns both as strings', async () => {
    const result = (await replayWithLines({}, { stdoutLines: ['hi'], stderrLines: [''] })) as {
      stdout: unknown
      stderr: unknown
    }
    expect(result.stdout).toBe('hi')
    expect(result.stderr).toBe('')
  })

  test('lines: { stdout: true, stderr: false }: stdout array, stderr string', async () => {
    const result = (await replayWithLines({ lines: { stdout: true, stderr: false } } as Options, {
      stdoutLines: ['a', 'b', ''],
      stderrLines: ['err'],
    })) as { stdout: unknown; stderr: unknown }
    expect(result.stdout).toEqual(['a', 'b'])
    expect(result.stderr).toBe('err')
  })

  test('lines: { stdout: false, all: true }: stdout key wins over all (string), stderr falls through all (array)', async () => {
    // stdout: o.stdout (false) wins -> string.
    // stderr: no stderr/fd2 keys, falls through to o.all (true) -> array.
    const result = (await replayWithLines({ lines: { stdout: false, all: true } } as Options, {
      stdoutLines: ['a', 'b'],
      stderrLines: ['err', ''],
    })) as { stdout: unknown; stderr: unknown }
    expect(result.stdout).toBe('a\nb')
    expect(result.stderr).toEqual(['err'])
  })

  test('lines: { stdout: false, fd1: true }: stdout key wins over fd1 (string)', async () => {
    const result = (await replayWithLines(
      { lines: { stdout: false, fd1: true } } as unknown as Options,
      { stdoutLines: ['a', 'b'], stderrLines: ['err'] },
    )) as { stdout: unknown; stderr: unknown }
    expect(result.stdout).toBe('a\nb')
    expect(result.stderr).toBe('err')
  })

  test('lines: { fd1: false, all: true }: fd1 wins over all when stdout omitted (string)', async () => {
    const result = (await replayWithLines(
      { lines: { fd1: false, all: true } } as unknown as Options,
      { stdoutLines: ['a', 'b'], stderrLines: ['err'] },
    )) as { stdout: unknown }
    expect(result.stdout).toBe('a\nb')
  })

  test('lines: { stdout: true, fd1: false }: stdout wins over fd1 (array)', async () => {
    const result = (await replayWithLines(
      { lines: { stdout: true, fd1: false } } as unknown as Options,
      { stdoutLines: ['a', 'b', ''], stderrLines: ['err'] },
    )) as { stdout: unknown }
    expect(result.stdout).toEqual(['a', 'b'])
  })

  test('lines: { stderr: false, fd2: true }: stderr key wins over fd2 (string)', async () => {
    const result = (await replayWithLines(
      { lines: { stderr: false, fd2: true } } as unknown as Options,
      { stdoutLines: [''], stderrLines: ['err1', 'err2'] },
    )) as { stderr: unknown }
    expect(result.stderr).toBe('err1\nerr2')
  })

  test('lines: { all: true } + all: true: result.all is array', async () => {
    const result = (await replayWithLines({ all: true, lines: { all: true } } as Options, {
      stdoutLines: [''],
      stderrLines: [''],
      allLines: ['x', 'y', ''],
    })) as { all: unknown }
    expect(result.all).toEqual(['x', 'y'])
  })

  test('lines: { all: false } + all: true: result.all is string', async () => {
    const result = (await replayWithLines({ all: true, lines: { all: false } } as Options, {
      stdoutLines: [''],
      stderrLines: [''],
      allLines: ['x', 'y'],
    })) as { all: unknown }
    expect(result.all).toBe('x\ny')
  })

  test('all: false with lines.all: true: result.all is undefined', async () => {
    const result = (await replayWithLines({ all: false, lines: { all: true } } as Options, {
      stdoutLines: [''],
      stderrLines: [''],
      allLines: ['x', 'y', ''],
    })) as { all?: unknown }
    expect('all' in result).toBe(false)
  })

  test('all undefined with lines: true: result.all is undefined', async () => {
    const result = (await replayWithLines(
      { lines: true },
      { stdoutLines: [''], stderrLines: [''], allLines: ['x', ''] },
    )) as { all?: unknown }
    expect('all' in result).toBe(false)
  })
})
