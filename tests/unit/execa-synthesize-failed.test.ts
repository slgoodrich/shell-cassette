import type { Options } from 'execa'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import { makeRecording } from '../helpers/recording.js'
import { makeSession } from '../helpers/session.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { execa: realExecaMock } = await import('execa')
const { execa } = await import('../../src/execa.js')

async function replayWith(
  options: Options,
  resultOverrides: Parameters<typeof makeRecording>[0] extends { result?: infer R } ? R : never,
): Promise<unknown> {
  const recording = makeRecording({
    call: { command: 'cmd', args: [], cwd: null, env: {}, stdin: null },
    result: resultOverrides,
  })
  const session = makeSession({
    loadedFile: { version: 2, recordedBy: null, recordings: [recording] },
  })
  setActiveCassette(session)
  process.env.SHELL_CASSETTE_MODE = 'replay'
  return await execa('cmd', [], options)
}

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
  })

  test('explicit failed: true throws when reject not false', async () => {
    await expect(
      replayWith({}, { exitCode: 0, signal: null, aborted: false, failed: true }),
    ).rejects.toThrow(/Command failed/)
  })

  test('explicit failed: false succeeds even when exitCode is non-zero', async () => {
    const r = (await replayWith(
      {},
      { exitCode: 1, signal: null, aborted: false, failed: false },
    )) as {
      failed: boolean
    }
    expect(r.failed).toBe(false)
  })

  test('legacy cassette (no failed field), exitCode !== 0: derives failed → throws', async () => {
    await expect(replayWith({}, { exitCode: 1, signal: null, aborted: false })).rejects.toThrow(
      /Command failed/,
    )
  })

  test('legacy cassette, signal kill (exitCode 0, signal SIGTERM): derives failed → throws', async () => {
    await expect(
      replayWith({}, { exitCode: 0, signal: 'SIGTERM', aborted: false }),
    ).rejects.toThrow(/Command failed/)
  })

  test('legacy cassette, aborted (exitCode 0, no signal, aborted true): derives failed → throws', async () => {
    await expect(replayWith({}, { exitCode: 0, signal: null, aborted: true })).rejects.toThrow(
      /Command failed/,
    )
  })

  test('legacy cassette, plain success (exitCode 0, no signal, not aborted): does not throw', async () => {
    const r = (await replayWith({}, { exitCode: 0, signal: null, aborted: false })) as {
      failed: boolean
    }
    expect(r.failed).toBe(false)
  })

  test('reject: false suppresses throw even when failed resolves true', async () => {
    const r = (await replayWith(
      { reject: false },
      { exitCode: 1, signal: null, aborted: false, failed: true },
    )) as { failed: boolean; exitCode: number }
    expect(r.failed).toBe(true)
    expect(r.exitCode).toBe(1)
  })
})
