import type { Options } from 'execa'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ShellCassetteError } from '../../src/errors.js'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { Result } from '../../src/types.js'
import { restoreEnv } from '../helpers/env.js'
import { makeRecording } from '../helpers/recording.js'
import { makeSession } from '../helpers/session.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { execa: realExecaMock } = await import('execa')
const { execa } = await import('../../src/execa.js')

const originalMode = process.env.SHELL_CASSETTE_MODE

async function replayWith(
  options: Options,
  resultOverrides: Partial<Result> = {},
): Promise<unknown> {
  const rec = makeRecording({
    call: { command: 'cmd', args: [], cwd: null, env: {}, stdin: null },
    result: resultOverrides,
  })
  const session = makeSession({
    loadedFile: { version: 2, recordedBy: null, recordings: [rec] },
  })
  setActiveCassette(session)
  process.env.SHELL_CASSETTE_MODE = 'replay'
  return await execa('cmd', [], { reject: false, ...options })
}

describe('execa synthesize: subprocess-API stubs', () => {
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
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
  })

  test('result.kill() returns false (no-op; no live subprocess to signal)', async () => {
    const r = (await replayWith({}, {})) as { kill: () => boolean }
    expect(typeof r.kill).toBe('function')
    expect(r.kill()).toBe(false)
  })

  test('result.kill(signal) returns false and accepts signal arg without effect', async () => {
    const r = (await replayWith({}, {})) as { kill: (sig?: string) => boolean }
    expect(r.kill('SIGTERM')).toBe(false)
  })

  test('result.pipe() throws ShellCassetteError with passthrough hint', async () => {
    const r = (await replayWith({}, {})) as { pipe: () => unknown }
    expect(() => r.pipe()).toThrow(ShellCassetteError)
    expect(() => r.pipe()).toThrow(/passthrough/i)
  })

  test('result[Symbol.asyncIterator]() throws ShellCassetteError with read-result hint', async () => {
    const r = (await replayWith({}, {})) as Record<string | symbol, unknown> & {
      [Symbol.asyncIterator]: () => unknown
    }
    expect(() => r[Symbol.asyncIterator]()).toThrow(ShellCassetteError)
    expect(() => r[Symbol.asyncIterator]()).toThrow(/result\.stdout/i)
  })

  test('thrown error (failed cassette) carries kill/pipe/asyncIterator methods', async () => {
    let caught: unknown
    try {
      await replayWith({ reject: true }, { exitCode: 1, failed: true })
      throw new Error('should not reach')
    } catch (e) {
      caught = e
    }
    const err = caught as Record<string | symbol, unknown> & {
      kill: () => boolean
      pipe: () => unknown
      [Symbol.asyncIterator]: () => unknown
    }
    expect(typeof err.kill).toBe('function')
    expect(err.kill()).toBe(false)
    expect(() => err.pipe()).toThrow(ShellCassetteError)
    expect(() => err[Symbol.asyncIterator]()).toThrow(ShellCassetteError)
  })
})
