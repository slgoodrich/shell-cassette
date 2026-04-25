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

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
})

afterEach(() => {
  clearActiveCassette()
  if (originalAck === undefined) {
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
  } else {
    process.env.SHELL_CASSETTE_ACK_REDACTION = originalAck
  }
})

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
})
