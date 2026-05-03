import type { Options } from 'execa'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { Result } from '../../src/types.js'
import { restoreEnv } from '../helpers/env.js'
import { makeRecording } from '../helpers/recording.js'
import { makeSession } from '../helpers/session.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { execa: realExecaMock } = await import('execa')
const { execa } = await import('../../src/execa.js')

const originalMode = process.env.SHELL_CASSETTE_MODE

async function replayWith(options: Options, resultOverrides: Partial<Result>): Promise<unknown> {
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

describe('execa synthesize: flag completeness', () => {
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

  test('plain success: all flags reachable as false', async () => {
    const r = (await replayWith({}, {})) as Record<string, unknown>
    expect(r.failed).toBe(false)
    expect(r.timedOut).toBe(false)
    expect(r.isCanceled).toBe(false)
    expect(r.isMaxBuffer).toBe(false)
    expect(r.isTerminated).toBe(false)
    expect(r.isForcefullyTerminated).toBe(false)
    expect(r.isGracefullyCanceled).toBe(false)
    expect(r.killed).toBe(false)
    expect(r.pipedFrom).toEqual([])
    expect(r.ipcOutput).toEqual([])
  })

  test('signal-killed: isTerminated and killed are true; signal field set', async () => {
    const r = (await replayWith({}, { signal: 'SIGKILL' })) as Record<string, unknown>
    expect(r.signal).toBe('SIGKILL')
    expect(r.killed).toBe(true)
    expect(r.isTerminated).toBe(true)
    expect(r.failed).toBe(true)
  })

  test('isMaxBuffer stored: surfaces on replay', async () => {
    const r = (await replayWith({}, { isMaxBuffer: true, failed: true })) as Record<string, unknown>
    expect(r.isMaxBuffer).toBe(true)
    expect(r.failed).toBe(true)
  })

  test('isForcefullyTerminated and isGracefullyCanceled stored: surface on replay', async () => {
    const r = (await replayWith(
      {},
      { isForcefullyTerminated: true, isGracefullyCanceled: true },
    )) as Record<string, unknown>
    expect(r.isForcefullyTerminated).toBe(true)
    expect(r.isGracefullyCanceled).toBe(true)
  })

  test('timedOut stored: surfaces on replay', async () => {
    const r = (await replayWith({}, { timedOut: true, signal: 'SIGTERM' })) as Record<
      string,
      unknown
    >
    expect(r.timedOut).toBe(true)
  })

  test('isCanceled mirrors aborted', async () => {
    const r = (await replayWith({}, { aborted: true })) as Record<string, unknown>
    expect(r.isCanceled).toBe(true)
  })
})
