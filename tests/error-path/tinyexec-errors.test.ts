import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AckRequiredError,
  ReplayMissError,
  ShellCassetteError,
  UnsupportedOptionError,
} from '../../src/errors.js'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import { makeSession } from '../helpers/session.js'

vi.mock('tinyexec', () => ({
  x: vi.fn(),
}))

const { x: realXMock } = await import('tinyexec')
const { x } = await import('../../src/tinyexec.js')

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

describe('tinyexec error paths', () => {
  test('UnsupportedOptionError on persist:true', async () => {
    await expect(x('echo', [], { persist: true })).rejects.toBeInstanceOf(UnsupportedOptionError)
  })

  test('UnsupportedOptionError inherits from ShellCassetteError', async () => {
    try {
      await x('echo', [], { persist: true })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ShellCassetteError)
    }
  })

  test('UnsupportedOptionError message contains option name and backlog reference', async () => {
    try {
      await x('echo', [], { persist: true })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('persist')
      expect((e as Error).message).toContain('backlog')
    }
  })

  test('AckRequiredError on record without ack env var', async () => {
    setActiveCassette(makeSession({ loadedFile: null }))
    delete process.env.SHELL_CASSETTE_ACK_REDACTION

    await expect(x('echo', ['hi'])).rejects.toBeInstanceOf(AckRequiredError)
    expect(realXMock).not.toHaveBeenCalled()
  })

  test('ReplayMissError when cassette empty in replay mode', async () => {
    setActiveCassette(makeSession({ loadedFile: { version: 1, recordedBy: null, recordings: [] } }))
    process.env.SHELL_CASSETTE_MODE = 'replay'

    await expect(x('echo', ['unrecorded'])).rejects.toBeInstanceOf(ReplayMissError)
  })

  test('ReplayMissError message includes the call signature', async () => {
    setActiveCassette(makeSession({ loadedFile: { version: 1, recordedBy: null, recordings: [] } }))
    process.env.SHELL_CASSETTE_MODE = 'replay'

    try {
      await x('git', ['status', '--porcelain'])
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ReplayMissError)
      expect((e as Error).message).toContain('git status --porcelain')
      expect((e as Error).message).toContain('To re-record')
    }
  })
})
