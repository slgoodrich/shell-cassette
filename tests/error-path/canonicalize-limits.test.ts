import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ReplayMissError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { writeCassetteFile } from '../../src/io.js'
import { serialize } from '../../src/serialize.js'
import type { CassetteFile } from '../../src/types.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'

// Build a cassette with a single recording whose call.command is `node` and
// one positional arg. The args field drives the matcher comparison.
function makeCassette(args: string[]): CassetteFile {
  return {
    version: 1,
    recordedBy: null,
    recordings: [
      {
        call: {
          command: 'node',
          args,
          cwd: null,
          env: {},
          stdin: null,
        },
        result: {
          stdoutLines: ['recorded', ''],
          stderrLines: [''],
          allLines: null,
          exitCode: 0,
          signal: null,
          durationMs: 1,
          aborted: false,
        },
        redactions: [],
      },
    ],
  }
}

describe('canonicalize limitations - documented current behavior', () => {
  let workspace: string
  const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
  const originalMode = process.env.SHELL_CASSETTE_MODE
  const originalCI = process.env.CI

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'shell-cassette-limits-'))
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    process.env.SHELL_CASSETTE_MODE = 'replay' // strict replay so misses throw
    delete process.env.CI
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
    restoreEnv('CI', originalCI)
  })

  test('relative tmp path (path.relative-style) does NOT normalize - documented limitation', async () => {
    // Recording was canonicalized as if it had been '<tmp>/foo' (a normalized
    // absolute path). Replay attempts a RELATIVE path that doesn't match any
    // tmp prefix regex, so canonicalize leaves it unchanged. Match fails.
    const cassettePath = path.join(workspace, 'rel.json')
    await writeCassetteFile(cassettePath, serialize(makeCassette(['-e', '<tmp>/foo'])))

    const result = useCassette(cassettePath, async () => {
      await execa('node', ['-e', '../../tmp/foo'])
    })
    await expect(result).rejects.toBeInstanceOf(ReplayMissError)
    // Error message includes 'canonical' so users see what was compared.
    await expect(result).rejects.toThrow(/canonical/)
  })

  test('custom $TMPDIR outside our regex table does NOT normalize - documented limitation', async () => {
    // Recording has a /scratch/... path. The default regex table covers
    // /tmp, /var/tmp, /var/folders/X/Y/T, /private/tmp, and Windows
    // C:\\Users\\<u>\\AppData\\Local\\Temp. /scratch is NOT covered, so the
    // recorded path is canonicalized as the literal string. A different
    // /scratch/... path on replay does not match.
    const cassettePath = path.join(workspace, 'scratch.json')
    await writeCassetteFile(cassettePath, serialize(makeCassette(['-e', '/scratch/RECORDED/foo'])))

    const result = useCassette(cassettePath, async () => {
      await execa('node', ['-e', '/scratch/REPLAY/foo'])
    })
    await expect(result).rejects.toBeInstanceOf(ReplayMissError)
  })
})
