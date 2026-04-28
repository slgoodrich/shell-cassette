import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import type { Canonicalize } from '../../src/types.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'

describe('useCassette per-call options - canonicalize override', () => {
  let tmp: string
  const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
  const originalMode = process.env.SHELL_CASSETTE_MODE
  const originalCI = process.env.CI

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-test-'))
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.CI
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
    restoreEnv('CI', originalCI)
  })

  test('default canonicalize matches recordings with same command + args', async () => {
    const cassettePath = path.join(tmp, 'default.json')
    // First pass: record
    await useCassette(cassettePath, async () => {
      await execa('node', ['-e', 'console.log("a")'])
    })
    // Second pass: replay (must match)
    await useCassette(cassettePath, async () => {
      const r = await execa('node', ['-e', 'console.log("a")'])
      expect(r.stdout).toBe('a')
    })
  })

  test('custom canonicalize: command-only matches across different args', async () => {
    const cassettePath = path.join(tmp, 'custom.json')
    const commandOnly: Canonicalize = (call) => ({ command: call.command })
    // Record one call
    await useCassette(cassettePath, { canonicalize: commandOnly }, async () => {
      await execa('node', ['-e', 'console.log("first")'])
    })
    // Replay with completely different args; matches because canonicalize ignores args
    await useCassette(cassettePath, { canonicalize: commandOnly }, async () => {
      const r = await execa('node', ['-e', 'console.log("second")'])
      // Synthesized output is from the recording, not the live call
      expect(r.stdout).toBe('first')
    })
  })

  test('cassette file content is identical between 2-arg and 3-arg useCassette forms', async () => {
    const a = path.join(tmp, 'two-arg.json')
    const b = path.join(tmp, 'three-arg.json')
    await useCassette(a, async () => {
      await execa('node', ['-e', 'console.log("x")'])
    })
    await useCassette(b, {}, async () => {
      await execa('node', ['-e', 'console.log("x")'])
    })
    const aContent = await readFile(a, 'utf8')
    const bContent = await readFile(b, 'utf8')
    // durationMs varies between real calls, so compare structure excluding timing
    const stripTiming = (raw: string) => {
      const parsed = JSON.parse(raw) as { recordings: { result: { durationMs?: number } }[] }
      for (const rec of parsed.recordings) {
        delete rec.result.durationMs
      }
      return parsed
    }
    expect(stripTiming(aContent)).toEqual(stripTiming(bContent))
  })
})
