import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { Recording } from '../../src/types.js'
import { makeSession } from '../helpers/session.js'

vi.mock('tinyexec', () => ({
  x: vi.fn(),
}))

const { x: realXMock } = await import('tinyexec')
const { x } = await import('../../src/tinyexec.js')

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

  test('captureResult preserves aborted=true through to recording', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realXMock).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 1,
      pid: 1,
      aborted: true,
      killed: true,
    } as never)

    await x('sleep', ['10'])
    expect(session.newRecordings[0]?.result.aborted).toBe(true)
  })

  test('synthesize emits aborted=true from a recording with aborted=true', async () => {
    // signal=null and aborted=true isolates the aborted-passthrough path from
    // the killed-derivation path (synthesize computes killed = signal !== null).
    const recording: Recording = {
      call: { command: 'sleep', args: ['10'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: [''],
        stderrLines: [''],
        allLines: null,
        exitCode: 1,
        signal: null,
        durationMs: 0,
        aborted: true,
      },
      redactions: [],
    }
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = await x('sleep', ['10'])
    expect(result.aborted).toBe(true)
    expect(result.killed).toBe(false)
    expect(realXMock).not.toHaveBeenCalled()
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
        aborted: false,
      },
      redactions: [],
    }
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
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
        aborted: false,
      },
      redactions: [],
    }
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
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
        aborted: false,
      },
      redactions: [],
    }
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
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
        aborted: false,
      },
      redactions: [],
    }
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
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
        aborted: false,
      },
      redactions: [],
    }
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
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
        aborted: false,
      },
      redactions: [],
    }
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
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
