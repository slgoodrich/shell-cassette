import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UnsupportedOptionError } from '../../src/errors.js'
import { _resetForTesting, clearActiveCassette } from '../../src/state.js'
import { restoreEnv } from '../helpers/env.js'
import { replayExeca } from '../helpers/execa-replay.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { execa: realExecaMock } = await import('execa')

const originalMode = process.env.SHELL_CASSETTE_MODE

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
    const r = (await replayExeca({}, {}, { reject: false })) as { kill: () => boolean }
    expect(typeof r.kill).toBe('function')
    expect(r.kill()).toBe(false)
  })

  test('result.kill(signal) returns false and accepts signal arg without effect', async () => {
    const r = (await replayExeca({}, {}, { reject: false })) as { kill: (sig?: string) => boolean }
    expect(r.kill('SIGTERM')).toBe(false)
  })

  test('result.pipe() throws UnsupportedOptionError with passthrough hint', async () => {
    const r = (await replayExeca({}, {}, { reject: false })) as { pipe: () => unknown }
    expect(() => r.pipe()).toThrow(UnsupportedOptionError)
    expect(() => r.pipe()).toThrow(/passthrough/i)
  })

  test('result[Symbol.asyncIterator]() throws UnsupportedOptionError with read-result hint', async () => {
    const r = (await replayExeca({}, {}, { reject: false })) as Record<string | symbol, unknown> & {
      [Symbol.asyncIterator]: () => unknown
    }
    expect(() => r[Symbol.asyncIterator]()).toThrow(UnsupportedOptionError)
    expect(() => r[Symbol.asyncIterator]()).toThrow(/result\.stdout/i)
  })

  test('thrown error (failed cassette) carries kill/pipe/asyncIterator methods', async () => {
    let caught: unknown
    try {
      await replayExeca({ reject: true }, { exitCode: 1, failed: true }, { reject: false })
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
    expect(() => err.pipe()).toThrow(UnsupportedOptionError)
    expect(() => err[Symbol.asyncIterator]()).toThrow(UnsupportedOptionError)
  })
})
