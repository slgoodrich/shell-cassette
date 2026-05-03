import type { Options } from 'tinyexec'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { Result } from '../../src/types.js'
import { restoreEnv } from '../helpers/env.js'
import { makeRecording } from '../helpers/recording.js'
import { makeSession } from '../helpers/session.js'

vi.mock('tinyexec', () => ({ x: vi.fn() }))

const { x: realXMock } = await import('tinyexec')
const { x } = await import('../../src/tinyexec.js')

const originalMode = process.env.SHELL_CASSETTE_MODE

async function replayWith(
  options: Partial<Options>,
  resultOverrides: Partial<Result>,
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
  return await x('cmd', [], options)
}

describe('tinyexec synthesize: failed resolution', () => {
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
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
  })

  test('throwOnError true, explicit failed: true throws', async () => {
    await expect(
      replayWith(
        { throwOnError: true },
        { exitCode: 0, signal: null, aborted: false, failed: true },
      ),
    ).rejects.toThrow(/Process exited with non-zero code/)
  })

  test('throwOnError true, legacy cassette signal kill (no failed field) throws via fallback', async () => {
    await expect(
      replayWith({ throwOnError: true }, { exitCode: 0, signal: 'SIGTERM', aborted: false }),
    ).rejects.toThrow(/Process exited/)
  })

  test('throwOnError true, legacy cassette aborted (no failed field) throws via fallback', async () => {
    await expect(
      replayWith({ throwOnError: true }, { exitCode: 0, signal: null, aborted: true }),
    ).rejects.toThrow(/Process exited/)
  })

  test('throwOnError true, plain success (exitCode 0, no signal, not aborted) does not throw', async () => {
    const r = (await replayWith(
      { throwOnError: true },
      { exitCode: 0, signal: null, aborted: false },
    )) as {
      exitCode: number
    }
    expect(r.exitCode).toBe(0)
  })

  test('throwOnError omitted: legacy aborted cassette does not throw', async () => {
    const r = (await replayWith({}, { exitCode: 0, signal: null, aborted: true })) as {
      aborted: boolean
    }
    expect(r.aborted).toBe(true)
  })
})
