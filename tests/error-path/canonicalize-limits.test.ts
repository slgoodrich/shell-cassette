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

// Build a cassette with a single recording whose call.command is `node` and
// one positional arg. The args field drives the matcher comparison.
function makeCassette(args: string[]): CassetteFile {
  return {
    version: 1,
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
      },
    ],
  }
}

describe('canonicalize limitations - documented current behavior', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'shell-cassette-limits-'))
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    process.env.SHELL_CASSETTE_MODE = 'replay' // strict replay so misses throw
    delete process.env.CI
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    delete process.env.SHELL_CASSETTE_MODE
  })

  test('relative tmp path (path.relative-style) does NOT normalize - documented limitation', async () => {
    // Recording was canonicalized as if it had been '<tmp>/foo' (a normalized
    // absolute path). Replay attempts a RELATIVE path that doesn't match any
    // tmp prefix regex, so canonicalize leaves it unchanged. Match fails.
    const cassettePath = path.join(workspace, 'rel.json')
    await writeCassetteFile(cassettePath, serialize(makeCassette(['-e', '<tmp>/foo'])))

    let caught: unknown
    try {
      await useCassette(cassettePath, async () => {
        await execa('node', ['-e', '../../tmp/foo'])
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ReplayMissError)
    // Error message includes 'canonical' so users see what was compared.
    expect((caught as Error).message).toContain('canonical')
  })

  test('custom $TMPDIR outside our regex table does NOT normalize - documented limitation', async () => {
    // Recording has a /scratch/... path. The default regex table covers
    // /tmp, /var/tmp, /var/folders/X/Y/T, /private/tmp, and Windows
    // C:\\Users\\<u>\\AppData\\Local\\Temp. /scratch is NOT covered, so the
    // recorded path is canonicalized as the literal string. A different
    // /scratch/... path on replay does not match.
    const cassettePath = path.join(workspace, 'scratch.json')
    await writeCassetteFile(cassettePath, serialize(makeCassette(['-e', '/scratch/RECORDED/foo'])))

    let caught: unknown
    try {
      await useCassette(cassettePath, async () => {
        await execa('node', ['-e', '/scratch/REPLAY/foo'])
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ReplayMissError)
  })
})
