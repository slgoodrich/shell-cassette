import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
const originalMode = process.env.SHELL_CASSETTE_MODE

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  // Pin the mode so CI=true on the runner doesn't force replay-strict.
  process.env.SHELL_CASSETTE_MODE = 'auto'
})

afterEach(() => {
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

describe('e2e record + replay', () => {
  test('node --version round-trips deterministically', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-e2e-'))
    try {
      const cp = path.join(tmp, 'node-version.json')

      // First run: live + record
      let firstStdout: string | undefined
      await useCassette(cp, async () => {
        const r = await execa('node', ['--version'])
        firstStdout = r.stdout
        expect(firstStdout).toMatch(/^v\d/)
      })

      // Second run: replay (no real subprocess)
      await useCassette(cp, async () => {
        const r = await execa('node', ['--version'])
        expect(r.stdout).toBe(firstStdout)
      })

      // Verify cassette contents
      const content = await readFile(cp, 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.recordings).toHaveLength(1)
      expect(parsed.recordings[0].call.command).toBe('node')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('failed subprocess preserves exit code on replay', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-e2e-'))
    try {
      const cp = path.join(tmp, 'fail.json')

      // First run: live, capture failure
      await useCassette(cp, async () => {
        try {
          await execa('node', ['-e', 'process.exit(2)'])
        } catch (e) {
          expect((e as { exitCode: number }).exitCode).toBe(2)
        }
      })

      // Second run: replay synthesizes ExecaError with exit 2
      await useCassette(cp, async () => {
        try {
          await execa('node', ['-e', 'process.exit(2)'])
          throw new Error('should not reach')
        } catch (e) {
          expect((e as { exitCode: number }).exitCode).toBe(2)
        }
      })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
