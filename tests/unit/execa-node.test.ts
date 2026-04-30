import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import { makeSession } from '../helpers/session.js'

// Mock execa BEFORE importing src/execa.ts so the top-level
// `await import('execa')` in src/execa.ts picks up the stub.
vi.mock('execa', () => ({
  execa: vi.fn(),
}))

const { execa: realExecaMock } = await import('execa')
const { execa, execaNode } = await import('../../src/execa.js')

describe('execaNode', () => {
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

  test('forwards node:true to underlying execa wrapper', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realExecaMock).mockResolvedValueOnce({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      isCanceled: false,
    } as never)

    await execaNode('script.mjs', ['arg1'])

    expect(realExecaMock).toHaveBeenCalledTimes(1)
    const call = vi.mocked(realExecaMock).mock.calls[0]
    if (!call) throw new Error('expected execa to be called once')
    expect(call[0]).toBe('script.mjs')
    expect(call[1]).toEqual(['arg1'])
    expect((call[2] as { node?: boolean }).node).toBe(true)
  })

  test('overrides user-provided node:false with node:true', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realExecaMock).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
      isCanceled: false,
    } as never)

    await execaNode('script.mjs', [], { node: false })

    const call = vi.mocked(realExecaMock).mock.calls[0]
    if (!call) throw new Error('expected execa to be called once')
    expect((call[2] as { node?: boolean }).node).toBe(true)
  })

  test('preserves other user-supplied options alongside node:true', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realExecaMock).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
      isCanceled: false,
    } as never)

    await execaNode('script.mjs', [], { cwd: '/tmp', timeout: 5000 })

    const call = vi.mocked(realExecaMock).mock.calls[0]
    if (!call) throw new Error('expected execa to be called once')
    const opts = call[2] as { node?: boolean; cwd?: string; timeout?: number }
    expect(opts.node).toBe(true)
    expect(opts.cwd).toBe('/tmp')
    expect(opts.timeout).toBe(5000)
  })

  test('Call.command stores the user-provided file, not "node <file>"', async () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    const session = makeSession({ loadedFile: null })
    setActiveCassette(session)

    vi.mocked(realExecaMock).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
      isCanceled: false,
    } as never)

    await execaNode('script.mjs', ['--flag'])

    expect(session.newRecordings).toHaveLength(1)
    expect(session.newRecordings[0]?.call.command).toBe('script.mjs')
    expect(session.newRecordings[0]?.call.args).toEqual(['--flag'])
  })

  test('execaNode is a distinct function from execa (not the same reference)', () => {
    expect(execaNode).not.toBe(execa)
    expect(typeof execaNode).toBe('function')
  })
})
