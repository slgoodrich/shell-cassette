import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'

describe('e2e: tmp path record-replay across mkdtemp variance', () => {
  let workspace: string
  const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
  const originalMode = process.env.SHELL_CASSETTE_MODE
  const originalCI = process.env.CI

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'shell-cassette-e2e-'))
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.CI
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
    restoreEnv('CI', originalCI)
  })

  function restoreEnv(key: string, original: string | undefined): void {
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }

  test('cassette recorded with one mkdtemp path replays under a different mkdtemp path', async () => {
    const cassettePath = path.join(workspace, 'cassette.json')

    // Nested try/finally so tmpA is cleaned even if mkdtemp(tmpB) throws.
    const tmpA = await mkdtemp(path.join(tmpdir(), 'shell-cassette-tmp-a-'))
    try {
      const tmpB = await mkdtemp(path.join(tmpdir(), 'shell-cassette-tmp-b-'))
      try {
        // First run: record. Pass tmp path as argv (NOT embedded in the -e source)
        // so node doesn't interpret backslash sequences as JS escapes on Windows.
        await useCassette(cassettePath, async () => {
          await execa('node', ['-e', 'console.log("recorded:" + process.argv[1])', tmpA])
        })

        // Sanity: cassette was created and is non-empty.
        const stored = await readFile(cassettePath, 'utf8')
        expect(stored.length).toBeGreaterThan(0)

        // Second run: different mkdtemp dir; canonicalize must match the prior recording.
        // The synthesized stdout MUST be from the recording (which captured tmpA's
        // path in its stdout), NOT a fresh execution (which would emit tmpB).
        // Asserting `not.toContain(tmpB)` proves we got the recording: live execution
        // would always include the new tmpB path that the script just printed.
        await useCassette(cassettePath, async () => {
          const r = await execa('node', ['-e', 'console.log("recorded:" + process.argv[1])', tmpB])
          expect(r.stdout).toContain('recorded:')
          expect(r.stdout).not.toContain(tmpB)
        })

        // No new recording should have been added; cassette content is unchanged.
        const after = await readFile(cassettePath, 'utf8')
        expect(after).toBe(stored)
      } finally {
        await rm(tmpB, { recursive: true, force: true })
      }
    } finally {
      await rm(tmpA, { recursive: true, force: true })
    }
  })
})
