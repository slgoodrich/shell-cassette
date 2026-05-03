import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { execa: realExecaMock } = await import('execa')
const { execa: wrappedExeca } = await import('../../src/execa.js')
const { _resetForTesting, clearActiveCassette, setActiveCassette } = await import(
  '../../src/state.js'
)
const { restoreEnv } = await import('../helpers/env.js')
const { makeSession } = await import('../helpers/session.js')
const { useTmpDir } = await import('../helpers/tmp-dir.js')

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION

describe('execa adapter: realCall swaps inputFile -> input on record path (#102)', () => {
  const tmp = useTmpDir('sc-input-swap-')

  beforeEach(() => {
    _resetForTesting()
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.CI
    vi.mocked(realExecaMock).mockReset()
    // Resolve to a minimal execa-shaped result so captureResult is happy.
    vi.mocked(realExecaMock).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      signal: null,
      isCanceled: false,
      failed: false,
    } as never)
  })

  afterEach(() => {
    _resetForTesting()
    clearActiveCassette()
    restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  })

  test('record path: real execa receives `input: <bytes>`, no `inputFile`', async () => {
    const fixture = path.join(tmp.ref(), 'in.txt')
    await writeFile(fixture, 'hello-from-file', 'utf8')

    const session = makeSession({
      name: 't',
      path: path.join(tmp.ref(), 'cassette.json'),
      loadedFile: null,
      matcher: null,
    })
    setActiveCassette(session)

    await wrappedExeca('node', ['-v'], { inputFile: fixture })

    expect(realExecaMock).toHaveBeenCalledTimes(1)
    const passedOptions = vi.mocked(realExecaMock).mock.calls[0]?.[2] as Record<string, unknown>
    expect(passedOptions.input).toBe('hello-from-file')
    expect(passedOptions.inputFile).toBeUndefined()
  })

  test('record path with explicit `input` string: forwarded as-is, no swap needed', async () => {
    const session = makeSession({
      name: 't',
      path: path.join(tmp.ref(), 'cassette.json'),
      loadedFile: null,
      matcher: null,
    })
    setActiveCassette(session)

    await wrappedExeca('node', ['-v'], { input: 'literal' })

    expect(realExecaMock).toHaveBeenCalledTimes(1)
    const passedOptions = vi.mocked(realExecaMock).mock.calls[0]?.[2] as Record<string, unknown>
    expect(passedOptions.input).toBe('literal')
    expect(passedOptions.inputFile).toBeUndefined()
  })
})
