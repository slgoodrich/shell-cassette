import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { serialize } from '../../src/serialize.js'
import { _resetForTesting, clearActiveCassette } from '../../src/state.js'
import { useCassette } from '../../src/use-cassette.js'

vi.mock('tinyexec', () => ({
  x: vi.fn(),
}))

const { x: realXMock } = await import('tinyexec')
const { x } = await import('../../src/tinyexec.js')

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-test-'))
  _resetForTesting()
  vi.mocked(realXMock).mockReset()
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  delete process.env.SHELL_CASSETTE_MODE
  delete process.env.CI
})

afterEach(async () => {
  _resetForTesting()
  clearActiveCassette()
  await rm(tmp, { recursive: true, force: true })
  delete process.env.SHELL_CASSETTE_ACK_REDACTION
})

describe('tinyexec integration', () => {
  test('record creates cassette file with new recording', async () => {
    vi.mocked(realXMock).mockResolvedValueOnce({
      stdout: 'recorded-output',
      stderr: '',
      exitCode: 0,
      pid: 1,
      aborted: false,
      killed: false,
    } as never)

    const cassettePath = path.join(tmp, 'test.json')
    await useCassette(cassettePath, async () => {
      await x('echo', ['recorded-output'])
    })

    const content = await readFile(cassettePath, 'utf8')
    const parsed = JSON.parse(content)
    expect(parsed.version).toBe(1)
    expect(parsed.recordings).toHaveLength(1)
    expect(parsed.recordings[0].call.command).toBe('echo')
    expect(parsed.recordings[0].result.stdoutLines).toEqual(['recorded-output'])
  })

  test('replay reads cassette file and synthesizes result', async () => {
    const cassettePath = path.join(tmp, 'test.json')

    const cassetteJson = serialize({
      version: 1,
      recordings: [
        {
          call: { command: 'echo', args: ['canned'], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: ['canned'],
            stderrLines: [''],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
          },
        },
      ],
    })
    await writeFile(cassettePath, cassetteJson, 'utf8')

    process.env.SHELL_CASSETTE_MODE = 'replay'

    let received: { stdout: string; exitCode: number } | null = null
    await useCassette(cassettePath, async () => {
      const r = (await x('echo', ['canned'])) as unknown as {
        stdout: string
        exitCode: number
      }
      received = r
    })

    expect(realXMock).not.toHaveBeenCalled()
    expect(received).not.toBeNull()
    expect((received as unknown as { stdout: string }).stdout).toBe('canned')
    expect((received as unknown as { exitCode: number }).exitCode).toBe(0)
  })

  test('lazy load: cassette file not read when no x() call happens', async () => {
    const cassettePath = path.join(tmp, 'never-loaded.json')

    await useCassette(cassettePath, async () => {
      // no x() calls in scope
    })

    // Cassette file should not exist (no recordings to write)
    await expect(stat(cassettePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('lazy write: cassette only written when newRecordings has entries', async () => {
    const cassettePath = path.join(tmp, 'replay-only.json')

    const cassetteJson = serialize({
      version: 1,
      recordings: [
        {
          call: { command: 'echo', args: ['hi'], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: ['hi'],
            stderrLines: [''],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 0,
          },
        },
      ],
    })
    await writeFile(cassettePath, cassetteJson, 'utf8')

    const beforeStat = await stat(cassettePath)
    process.env.SHELL_CASSETTE_MODE = 'replay'

    await useCassette(cassettePath, async () => {
      await x('echo', ['hi']) // matches recording, no new write
    })

    const afterStat = await stat(cassettePath)
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs)
  })
})
