import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ReplayMissError, ShellCassetteError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { writeCassetteFile } from '../../src/io.js'
import { serialize } from '../../src/serialize.js'
import type { CassetteFile } from '../../src/types.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { makeRecording } from '../helpers/recording.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

// Build a cassette with a single recording whose call.command is `node` and
// one positional arg. The args field drives the matcher comparison.
function makeCassette(args: string[]): CassetteFile {
  return {
    version: 1,
    recordedBy: null,
    recordings: [
      makeRecording({
        call: { command: 'node', args, cwd: null, env: {}, stdin: null },
        result: { stdoutLines: ['recorded', ''], stderrLines: [''], durationMs: 1 },
      }),
    ],
  }
}

describe('canonicalize limitations - documented current behavior', () => {
  const workspaceDir = useTmpDir('shell-cassette-limits-')
  const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
  const originalMode = process.env.SHELL_CASSETTE_MODE
  const originalCI = process.env.CI

  beforeEach(() => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    process.env.SHELL_CASSETTE_MODE = 'replay' // strict replay so misses throw
    delete process.env.CI
  })

  afterEach(() => {
    restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
    restoreEnv('CI', originalCI)
  })

  test('relative tmp path (path.relative-style) does NOT normalize - documented limitation', async () => {
    // Recording was canonicalized as if it had been '<tmp>/foo' (a normalized
    // absolute path). Replay attempts a RELATIVE path that doesn't match any
    // tmp prefix regex, so canonicalize leaves it unchanged. Match fails.
    const cassettePath = path.join(workspaceDir.ref(), 'rel.json')
    await writeCassetteFile(cassettePath, serialize(makeCassette(['-e', '<tmp>/foo'])))

    const result = useCassette(cassettePath, async () => {
      await execa('node', ['-e', '../../tmp/foo'])
    })
    await expect(result).rejects.toBeInstanceOf(ReplayMissError)
    await expect(result).rejects.toBeInstanceOf(ShellCassetteError)
    // Error message includes 'canonical' so users see what was compared.
    await expect(result).rejects.toThrow(/canonical/)
  })

  test('custom $TMPDIR outside our regex table does NOT normalize - documented limitation', async () => {
    // Recording has a /scratch/... path. The default regex table covers
    // /tmp, /var/tmp, /var/folders/X/Y/T, /private/tmp, and Windows
    // C:\\Users\\<u>\\AppData\\Local\\Temp. /scratch is NOT covered, so the
    // recorded path is canonicalized as the literal string. A different
    // /scratch/... path on replay does not match.
    const cassettePath = path.join(workspaceDir.ref(), 'scratch.json')
    await writeCassetteFile(cassettePath, serialize(makeCassette(['-e', '/scratch/RECORDED/foo'])))

    const result = useCassette(cassettePath, async () => {
      await execa('node', ['-e', '/scratch/REPLAY/foo'])
    })
    await expect(result).rejects.toBeInstanceOf(ReplayMissError)
    await expect(result).rejects.toBeInstanceOf(ShellCassetteError)
  })
})
