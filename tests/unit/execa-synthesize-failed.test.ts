import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette } from '../../src/state.js'
import { restoreEnv } from '../helpers/env.js'
import { replayExeca } from '../helpers/execa-replay.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { execa: realExecaMock } = await import('execa')

const originalMode = process.env.SHELL_CASSETTE_MODE

describe('execa synthesize: failed resolution', () => {
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

  test('explicit failed: true throws when reject not false', async () => {
    await expect(
      replayExeca({}, { exitCode: 0, signal: null, aborted: false, failed: true }),
    ).rejects.toThrow(/Command failed/)
  })

  test('explicit failed: false succeeds even when exitCode is non-zero', async () => {
    const r = (await replayExeca(
      {},
      { exitCode: 1, signal: null, aborted: false, failed: false },
    )) as {
      failed: boolean
    }
    expect(r.failed).toBe(false)
  })

  test('legacy cassette (no failed field), exitCode !== 0: derives failed → throws', async () => {
    await expect(replayExeca({}, { exitCode: 1, signal: null, aborted: false })).rejects.toThrow(
      /Command failed/,
    )
  })

  test('legacy cassette, signal kill (exitCode 0, signal SIGTERM): derives failed → throws', async () => {
    await expect(
      replayExeca({}, { exitCode: 0, signal: 'SIGTERM', aborted: false }),
    ).rejects.toThrow(/Command failed/)
  })

  test('legacy cassette, aborted (exitCode 0, no signal, aborted true): derives failed → throws', async () => {
    await expect(replayExeca({}, { exitCode: 0, signal: null, aborted: true })).rejects.toThrow(
      /Command failed/,
    )
  })

  test('legacy cassette, plain success (exitCode 0, no signal, not aborted): does not throw', async () => {
    const r = (await replayExeca({}, { exitCode: 0, signal: null, aborted: false })) as {
      failed: boolean
    }
    expect(r.failed).toBe(false)
  })

  test('reject: false suppresses throw even when failed resolves true', async () => {
    const r = (await replayExeca(
      { reject: false },
      { exitCode: 1, signal: null, aborted: false, failed: true },
    )) as { failed: boolean; exitCode: number }
    expect(r.failed).toBe(true)
    expect(r.exitCode).toBe(1)
  })
})
