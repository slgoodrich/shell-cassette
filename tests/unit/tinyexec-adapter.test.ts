import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import { makeRecording } from '../helpers/recording.js'
import { makeSession } from '../helpers/session.js'

vi.mock('tinyexec', () => ({
  x: vi.fn(),
}))

const { x: realXMock } = await import('tinyexec')
const { x, exec, xSync } = await import('../../src/tinyexec.js')
const { ShellCassetteError } = await import('../../src/errors.js')

describe('tinyexec adapter', () => {
  test('exec is an alias of x', () => {
    expect(exec).toBe(x)
  })

  test('xSync stub throws ShellCassetteError pointing to issue #82', () => {
    expect(() => xSync()).toThrow(ShellCassetteError)
    try {
      xSync()
    } catch (e) {
      expect((e as Error).message).toContain('xSync')
      expect((e as Error).message).toContain('#82')
    }
  })

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

    // Real tinyexec exposes aborted/killed as OutputApi getters on the
    // pre-await ExecProcess, not on the resolved Output. The wrapper
    // snapshots them via `proc.aborted` / `proc.killed` before await
    // resolves (#126). Mock that shape: a Promise carrying the OutputApi
    // fields as own properties.
    const fakeProc = Object.assign(
      Promise.resolve({ stdout: '', stderr: '', exitCode: 1, pid: 1 }),
      { aborted: true, killed: true },
    )
    vi.mocked(realXMock).mockReturnValueOnce(fakeProc as never)

    await x('sleep', ['10'])
    expect(session.newRecordings[0]?.result.aborted).toBe(true)
  })

  test('synthesize emits aborted=true from a recording with aborted=true', async () => {
    // signal=null and aborted=true isolates the aborted-passthrough path from
    // the killed-derivation path (synthesize computes killed = signal !== null).
    const recording = makeRecording({
      call: { command: 'sleep', args: ['10'], cwd: null, env: {}, stdin: null },
      result: { stdoutLines: [''], stderrLines: [''], exitCode: 1, aborted: true },
    })
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

    // Same pre-await snapshot contract as the aborted test above.
    const fakeProc = Object.assign(
      Promise.resolve({ stdout: '', stderr: '', exitCode: 143, pid: 1 }),
      { aborted: false, killed: true },
    )
    vi.mocked(realXMock).mockReturnValueOnce(fakeProc as never)

    await x('sleep', ['10'])
    expect(session.newRecordings[0]?.result.signal).toBe('SIGTERM')
  })

  test('synthesize returns tinyexec-shaped result on replay', async () => {
    const recording = makeRecording({
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: { stdoutLines: ['hi'], stderrLines: [''] },
    })
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
    const recording = makeRecording({
      call: { command: 'false', args: [], cwd: null, env: {}, stdin: null },
      result: { stdoutLines: [''], stderrLines: [''], exitCode: 1 },
    })
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    await expect(x('false', [], { throwOnError: true })).rejects.toThrow(/non-zero code: 1/)
  })

  test('synthesize does NOT throw on non-zero by default (inverse of execa)', async () => {
    const recording = makeRecording({
      call: { command: 'false', args: [], cwd: null, env: {}, stdin: null },
      result: { stdoutLines: [''], stderrLines: [''], exitCode: 1 },
    })
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = await x('false', [])
    expect(result.exitCode).toBe(1)
  })

  test('synthesize result.process throws ShellCassetteError on access in replay', async () => {
    const recording = makeRecording({
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: { stdoutLines: ['hi'], stderrLines: [''] },
    })
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = await x('echo', ['hi'])
    // Reading result.process surfaces a clear shell-cassette error rather
    // than a confusing TypeError on a downstream property access. Closes #83.
    expect(() => (result as unknown as { process: unknown }).process).toThrow(ShellCassetteError)
    try {
      ;(result as unknown as { process: unknown }).process
    } catch (e) {
      expect((e as Error).message).toContain('result.process is not available in replay')
      expect((e as Error).message).toContain('SHELL_CASSETTE_MODE=passthrough')
    }
  })

  test('synthesize result.pipe() throws UnsupportedOptionError', async () => {
    const recording = makeRecording({
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: { stdoutLines: ['hi'], stderrLines: [''] },
    })
    const session = makeSession({
      loadedFile: { version: 1, recordedBy: null, recordings: [recording] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const result = (await x('echo', ['hi'])) as unknown as { pipe: () => void }
    expect(() => result.pipe()).toThrow(/pipe.*not supported/i)
  })

  test('synthesize async iteration throws UnsupportedOptionError', async () => {
    const recording = makeRecording({
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: { stdoutLines: ['hi'], stderrLines: [''] },
    })
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
