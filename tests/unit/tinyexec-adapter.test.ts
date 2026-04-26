import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { MatcherState } from '../../src/matcher.js'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { CassetteSession, Recording } from '../../src/types.js'

vi.mock('tinyexec', () => ({
  x: vi.fn(),
}))

const { x: realXMock } = await import('tinyexec')
const { x } = await import('../../src/tinyexec.js')

const makeSession = (overrides: Partial<CassetteSession> = {}): CassetteSession => {
  const base: CassetteSession = {
    name: 'test',
    path: '/tmp/test.json',
    scopeDefault: 'auto',
    loadedFile: { version: 1, recordings: [] },
    matcher: null,
    newRecordings: [],
    ...overrides,
  }
  // Mirror wrapper.ts lazy-load invariant: if loadedFile is set, matcher must
  // also be set. (Wrapper only inits matcher on the lazy-load path.)
  if (base.loadedFile !== null && base.matcher === null) {
    base.matcher = new MatcherState(base.loadedFile.recordings, DEFAULT_CONFIG.matcher)
  }
  return base
}

describe('tinyexec adapter', () => {
  beforeEach(() => {
    _resetForTesting()
    vi.mocked(realXMock).mockReset()
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    delete process.env.CI
  })

  afterEach(() => {
    _resetForTesting()
    clearActiveCassette()
  })

  test('passthrough calls real tinyexec when no cassette', async () => {
    vi.mocked(realXMock).mockResolvedValueOnce({
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
      pid: 123,
      aborted: false,
      killed: false,
    } as never)

    const result = await x('echo', ['hello'])
    expect(realXMock).toHaveBeenCalledWith('echo', ['hello'], {})
    expect(result.stdout).toBe('hello')
  })

  test('buildCall extracts cwd and env from nodeOptions', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realXMock).mockResolvedValueOnce({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      pid: 1,
      aborted: false,
      killed: false,
    } as never)

    await x('git', ['status'], {
      nodeOptions: { cwd: '/repo', env: { GIT_TERMINAL_PROMPT: '0' } },
    })

    expect(session.newRecordings[0]?.call.cwd).toBe('/repo')
    expect(session.newRecordings[0]?.call.env).toEqual({ GIT_TERMINAL_PROMPT: '0' })
  })

  test('captureResult maps stdout/stderr to line arrays', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realXMock).mockResolvedValueOnce({
      stdout: 'a\nb',
      stderr: 'err',
      exitCode: 0,
      pid: 1,
      aborted: false,
      killed: false,
    } as never)

    await x('node', ['-e', 'console.log("a"); console.log("b"); console.error("err")'])

    expect(session.newRecordings[0]?.result.stdoutLines).toEqual(['a', 'b'])
    expect(session.newRecordings[0]?.result.stderrLines).toEqual(['err'])
    expect(session.newRecordings[0]?.result.allLines).toBeNull()
  })

  test('captureResult maps killed=true to signal=SIGTERM', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realXMock).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 143,
      pid: 1,
      aborted: false,
      killed: true,
    } as never)

    await x('sleep', ['10'])
    expect(session.newRecordings[0]?.result.signal).toBe('SIGTERM')
  })

  test('synthesize returns tinyexec-shaped result on replay', async () => {
    const recording: Recording = {
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: ['hi'],
        stderrLines: [''],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
      },
    }
    const session = makeSession({
      loadedFile: { version: 1, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = await x('echo', ['hi'])

    expect(result.stdout).toBe('hi')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.killed).toBe(false)
    expect(result.aborted).toBe(false)
    expect(realXMock).not.toHaveBeenCalled()
  })

  test('synthesize honors throwOnError when exit code is non-zero', async () => {
    const recording: Recording = {
      call: { command: 'false', args: [], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: [''],
        stderrLines: [''],
        allLines: null,
        exitCode: 1,
        signal: null,
        durationMs: 0,
      },
    }
    const session = makeSession({
      loadedFile: { version: 1, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    await expect(x('false', [], { throwOnError: true })).rejects.toThrow(/non-zero code: 1/)
  })

  test('synthesize does NOT throw on non-zero by default (inverse of execa)', async () => {
    const recording: Recording = {
      call: { command: 'false', args: [], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: [''],
        stderrLines: [''],
        allLines: null,
        exitCode: 1,
        signal: null,
        durationMs: 0,
      },
    }
    const session = makeSession({
      loadedFile: { version: 1, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = await x('false', [])
    expect(result.exitCode).toBe(1)
  })

  test('synthesize result.process is null on replay', async () => {
    const recording: Recording = {
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: ['hi'],
        stderrLines: [''],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
      },
    }
    const session = makeSession({
      loadedFile: { version: 1, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = (await x('echo', ['hi'])) as unknown as { process: unknown }
    expect(result.process).toBeNull()
  })

  test('synthesize result.pipe() throws UnsupportedOptionError', async () => {
    const recording: Recording = {
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: ['hi'],
        stderrLines: [''],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
      },
    }
    const session = makeSession({
      loadedFile: { version: 1, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = (await x('echo', ['hi'])) as unknown as { pipe: () => void }
    expect(() => result.pipe()).toThrow(/pipe.*not supported/i)
  })

  test('synthesize async iteration throws UnsupportedOptionError', async () => {
    const recording: Recording = {
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: ['hi'],
        stderrLines: [''],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
      },
    }
    const session = makeSession({
      loadedFile: { version: 1, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = await x('echo', ['hi'])
    expect(() => {
      const it = (result as { [Symbol.asyncIterator]: () => unknown })[Symbol.asyncIterator]()
      return it
    }).toThrow(/async iteration.*not supported/i)
  })
})
