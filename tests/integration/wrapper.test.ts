import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa as wrappedExeca } from '../../src/execa.js'
import { clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { CassetteSession } from '../../src/types.js'

const sessionAt = (sessionPath: string): CassetteSession => ({
  name: 'test',
  path: sessionPath,
  scopeDefault: 'auto',
  loadedFile: null,
  matcher: null,
  newRecordings: [],
})

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
const originalMode = process.env.SHELL_CASSETTE_MODE

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  // Pin the mode so CI=true on the runner doesn't force replay-strict.
  process.env.SHELL_CASSETTE_MODE = 'auto'
})

afterEach(() => {
  clearActiveCassette()
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = original
  }
}

describe('wrapped execa', () => {
  test('passthrough when no active cassette', async () => {
    const result = await wrappedExeca('node', ['-e', 'console.log("hi")'])
    expect(result.stdout).toContain('hi')
    expect(result.exitCode).toBe(0)
  })

  test('records into active cassette when in record mode', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const session = sessionAt(path.join(tmp, 'cassette.json'))
      setActiveCassette(session)
      await wrappedExeca('node', ['-e', 'console.log("recorded")'])
      expect(session.newRecordings).toHaveLength(1)
      expect(session.newRecordings[0]?.call.command).toBe('node')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('throws AckRequiredError when recording without ack', async () => {
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const session = sessionAt(path.join(tmp, 'cassette.json'))
      setActiveCassette(session)
      await expect(wrappedExeca('node', ['-e', 'console.log("x")'])).rejects.toThrow(
        /SHELL_CASSETTE_ACK_REDACTION/,
      )
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('throws UnsupportedOptionError on unsupported option', async () => {
    await expect(
      // @ts-expect-error: deliberate unsupported option
      wrappedExeca('node', ['-v'], { ipc: true }),
    ).rejects.toThrow(/ipc/)
  })

  test('captures and replays `all` when option is set', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const cassettePath = path.join(tmp, 'cassette.json')

      // Record
      const recordSession = sessionAt(cassettePath)
      setActiveCassette(recordSession)
      const recorded = await wrappedExeca(
        'node',
        ['-e', 'console.log("out"); console.error("err")'],
        { all: true },
      )
      expect(typeof recorded.all).toBe('string')
      expect(recorded.all).toContain('out')
      expect(recorded.all).toContain('err')
      expect(recordSession.newRecordings[0]?.result.allLines).not.toBeNull()
      clearActiveCassette()

      // persist
      const { writeCassetteFile } = await import('../../src/io.js')
      const { serialize } = await import('../../src/serialize.js')
      await writeCassetteFile(
        cassettePath,
        serialize({ version: 1, recordings: recordSession.newRecordings }),
      )

      // Replay
      const replaySession = sessionAt(cassettePath)
      setActiveCassette(replaySession)
      const replayed = await wrappedExeca(
        'node',
        ['-e', 'console.log("out"); console.error("err")'],
        { all: true },
      )
      expect(replayed.all).toContain('out')
      expect(replayed.all).toContain('err')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('legacy cassette (no allLines) still replays all via stdout+stderr concat', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const cassettePath = path.join(tmp, 'cassette.json')
      const { writeFile } = await import('node:fs/promises')
      const legacy = {
        version: 1,
        recordings: [
          {
            call: {
              command: 'node',
              args: ['-v'],
              cwd: null,
              env: {},
              stdin: null,
            },
            result: {
              stdoutLines: ['v22.0.0', ''],
              stderrLines: [''],
              exitCode: 0,
              signal: null,
              durationMs: 1,
            },
          },
        ],
      }
      await writeFile(cassettePath, JSON.stringify(legacy), 'utf8')

      const session = sessionAt(cassettePath)
      setActiveCassette(session)
      const replayed = await wrappedExeca('node', ['-v'], { all: true })
      expect(replayed.all).toContain('v22.0.0')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
