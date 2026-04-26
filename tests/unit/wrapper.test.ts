import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AckRequiredError,
  NoActiveSessionError,
  ReplayMissError,
  UnsupportedOptionError,
} from '../../src/errors.js'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { Recording } from '../../src/types.js'
import { type RunnerHooks, runWrapped } from '../../src/wrapper.js'
import { makeSession } from '../helpers/session.js'

type FakeOpts = { fake?: true }
type FakeResult = { stdout: string; exitCode: number }

const baseHooks = (
  realCall: (file: string, args: readonly string[], options: FakeOpts) => Promise<FakeResult>,
): RunnerHooks<FakeOpts, FakeResult> => ({
  validate: () => {},
  buildCall: (file, args) => ({
    command: file,
    args: [...args],
    cwd: null,
    env: {},
    stdin: null,
  }),
  realCall,
  captureResult: (raw) => {
    const r = raw as FakeResult
    return {
      stdoutLines: r.stdout.split('\n'),
      stderrLines: [''],
      allLines: null,
      exitCode: r.exitCode,
      signal: null,
      durationMs: 0,
    }
  },
  synthesize: (rec) => ({
    stdout: rec.result.stdoutLines.join('\n'),
    exitCode: rec.result.exitCode,
  }),
})

describe('runWrapped (envelope)', () => {
  beforeEach(() => {
    _resetForTesting()
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    delete process.env.CI
  })

  afterEach(() => {
    _resetForTesting()
    clearActiveCassette()
    // Symmetric with beforeEach so the last test's env state doesn't leak past
    // this file (vitest's per-file isolation hides this today, but a future
    // pool config without isolation would expose it).
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    delete process.env.CI
  })

  test('passthrough when no active cassette and mode is not replay', async () => {
    const realCall = vi.fn(async () => ({ stdout: 'hello', exitCode: 0 }))
    const result = await runWrapped('echo', ['hello'], {}, baseHooks(realCall))
    expect(realCall).toHaveBeenCalledOnce()
    expect(result).toEqual({ stdout: 'hello', exitCode: 0 })
  })

  test('NoActiveSessionError when CI=true forces replay and no session is bound', async () => {
    process.env.CI = 'true'
    const realCall = vi.fn()
    try {
      await runWrapped('rm', ['-rf', '/tmp/whatever'], {}, baseHooks(realCall as never))
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(NoActiveSessionError)
      const msg = (e as Error).message
      expect(msg).toContain('replay mode')
      expect(msg).toContain('useCassette')
      expect(msg).toContain('shell-cassette/vitest')
      expect(msg).toContain('SHELL_CASSETTE_MODE=passthrough')
    }
    expect(realCall).not.toHaveBeenCalled()
  })

  test('NoActiveSessionError when SHELL_CASSETTE_MODE=replay and no session is bound', async () => {
    process.env.SHELL_CASSETTE_MODE = 'replay'
    const realCall = vi.fn()
    await expect(
      runWrapped('echo', ['hi'], {}, baseHooks(realCall as never)),
    ).rejects.toBeInstanceOf(NoActiveSessionError)
    expect(realCall).not.toHaveBeenCalled()
  })

  test('explicit SHELL_CASSETTE_MODE=passthrough still passes through with no session', async () => {
    process.env.CI = 'true'
    process.env.SHELL_CASSETTE_MODE = 'passthrough'
    const realCall = vi.fn(async () => ({ stdout: 'hi', exitCode: 0 }))
    const result = await runWrapped('echo', ['hi'], {}, baseHooks(realCall))
    expect(realCall).toHaveBeenCalledOnce()
    expect(result.exitCode).toBe(0)
  })

  test('validate is called even when no active cassette', async () => {
    const validate = vi.fn(() => {
      throw new UnsupportedOptionError('test')
    })
    const realCall = vi.fn()
    const hooks: RunnerHooks<FakeOpts, FakeResult> = {
      ...baseHooks(realCall as never),
      validate,
    }
    await expect(runWrapped('echo', [], {}, hooks)).rejects.toBeInstanceOf(UnsupportedOptionError)
    expect(validate).toHaveBeenCalledOnce()
    expect(realCall).not.toHaveBeenCalled()
  })

  test('record path requires ack gate', async () => {
    const session = makeSession({ scopeDefault: 'auto', loadedFile: null })
    setActiveCassette(session)
    const realCall = vi.fn(async () => ({ stdout: 'x', exitCode: 0 }))
    await expect(runWrapped('echo', [], {}, baseHooks(realCall))).rejects.toBeInstanceOf(
      AckRequiredError,
    )
    expect(realCall).not.toHaveBeenCalled()
    clearActiveCassette()
  })

  test('replay path returns synthesized result on match', async () => {
    const recording: Recording = {
      call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: ['hi', ''],
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

    const realCall = vi.fn()
    const result = await runWrapped('echo', ['hi'], {}, baseHooks(realCall as never))
    expect(realCall).not.toHaveBeenCalled()
    expect(result).toEqual({ stdout: 'hi\n', exitCode: 0 })
    clearActiveCassette()
  })

  test('replay path throws ReplayMissError when no match', async () => {
    const session = makeSession({
      loadedFile: { version: 1, recordings: [] },
    })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    const realCall = vi.fn()
    await expect(
      runWrapped('echo', ['hi'], {}, baseHooks(realCall as never)),
    ).rejects.toBeInstanceOf(ReplayMissError)
    clearActiveCassette()
  })

  test('record path captures result and returns it', async () => {
    const session = makeSession({ scopeDefault: 'auto', loadedFile: null })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const realCall = vi.fn(async () => ({ stdout: 'recorded', exitCode: 0 }))

    const result = await runWrapped('echo', ['recorded'], {}, baseHooks(realCall))

    expect(result).toEqual({ stdout: 'recorded', exitCode: 0 })
    expect(session.newRecordings).toHaveLength(1)
    expect(session.newRecordings[0]?.result.stdoutLines).toEqual(['recorded'])
    clearActiveCassette()
  })

  test('record path captures error and re-throws', async () => {
    const session = makeSession({ scopeDefault: 'auto', loadedFile: null })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'

    const fakeError = Object.assign(new Error('subprocess failed'), {
      stdout: 'partial',
      exitCode: 1,
    })
    const realCall = vi.fn(async () => {
      throw fakeError
    })

    await expect(runWrapped('echo', [], {}, baseHooks(realCall))).rejects.toBe(fakeError)
    expect(session.newRecordings).toHaveLength(1)
    expect(session.newRecordings[0]?.result.exitCode).toBe(1)
    clearActiveCassette()
  })

  test('auto matcher miss without ack: AckRequiredError message includes matcher-miss context', async () => {
    // Existing recording for `git status`; we'll call `git log` so the matcher misses.
    const recording: Recording = {
      call: { command: 'git', args: ['status'], cwd: null, env: {}, stdin: null },
      result: {
        stdoutLines: ['', ''],
        stderrLines: [''],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
      },
    }
    const session = makeSession({
      scopeDefault: 'auto',
      loadedFile: { version: 1, recordings: [recording] },
    })
    setActiveCassette(session)
    // ack intentionally NOT set
    const realCall = vi.fn()

    try {
      await runWrapped('git', ['log'], {}, baseHooks(realCall as never))
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(AckRequiredError)
      const msg = (e as Error).message
      expect(msg).toContain('auto mode')
      expect(msg).toContain('no recording matched')
      expect(msg).toContain('git log')
      // Original ack help text is still appended
      expect(msg).toContain('SHELL_CASSETTE_ACK_REDACTION')
    } finally {
      expect(realCall).not.toHaveBeenCalled()
      clearActiveCassette()
    }
  })

  test('explicit record mode without ack: AckRequiredError message is NOT augmented', async () => {
    const session = makeSession({ scopeDefault: 'auto', loadedFile: null })
    setActiveCassette(session)
    process.env.SHELL_CASSETTE_MODE = 'record'
    // ack intentionally NOT set
    const realCall = vi.fn()

    try {
      await runWrapped('git', ['log'], {}, baseHooks(realCall as never))
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(AckRequiredError)
      const msg = (e as Error).message
      // Positive assertion: explicit-record path returns the unmodified ack
      // help text from src/ack.ts, which starts with "refusing to record".
      // Augmented messages instead start with "auto mode:".
      expect(msg.startsWith('refusing to record')).toBe(true)
      expect(msg).toContain('SHELL_CASSETTE_ACK_REDACTION')
    } finally {
      expect(realCall).not.toHaveBeenCalled()
      clearActiveCassette()
    }
  })
})
