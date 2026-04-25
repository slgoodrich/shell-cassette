import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { log } from '../../src/log.js'

describe('log', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>
  const originalEnv = process.env.SHELL_CASSETTE_LOG

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    if (originalEnv === undefined) {
      // biome-ignore lint/performance/noDelete: env var must be unset, not stringified to "undefined"
      delete process.env.SHELL_CASSETTE_LOG
    } else {
      process.env.SHELL_CASSETTE_LOG = originalEnv
    }
  })

  test('writes to stderr with shell-cassette: prefix', () => {
    // biome-ignore lint/performance/noDelete: env var must be unset, not stringified to "undefined"
    delete process.env.SHELL_CASSETTE_LOG
    log('hello world')
    expect(stderrSpy).toHaveBeenCalledOnce()
    const call = stderrSpy.mock.calls[0]?.[0] as string
    expect(call).toMatch(/^shell-cassette: hello world\n$/)
  })

  test('SHELL_CASSETTE_LOG=silent suppresses output', () => {
    process.env.SHELL_CASSETTE_LOG = 'silent'
    log('should not appear')
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  test('any value other than silent emits normally', () => {
    process.env.SHELL_CASSETTE_LOG = 'verbose'
    log('shown')
    expect(stderrSpy).toHaveBeenCalledOnce()
  })
})
