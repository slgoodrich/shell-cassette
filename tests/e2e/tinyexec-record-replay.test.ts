import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { _resetForTesting } from '../../src/state.js'
import { x } from '../../src/tinyexec.js'
import { useCassette } from '../../src/use-cassette.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const tmpDir = useTmpDir('shell-cassette-e2e-')

beforeEach(() => {
  _resetForTesting()
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  delete process.env.SHELL_CASSETTE_MODE
  delete process.env.CI
})

afterEach(() => {
  _resetForTesting()
  delete process.env.SHELL_CASSETTE_ACK_REDACTION
})

describe('tinyexec e2e', () => {
  test('record then replay round-trip on node --version', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'node-version.json')

    let recordedStdout = ''
    await useCassette(cassettePath, async () => {
      const r = await x('node', ['--version'])
      recordedStdout = r.stdout
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toMatch(/^v\d+\.\d+\.\d+/)
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    await useCassette(cassettePath, async () => {
      const r = await x('node', ['--version'])
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toBe(recordedStdout)
    })
  })

  test('record then replay handles non-zero exit (no throw by default)', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'node-fail.json')

    await useCassette(cassettePath, async () => {
      const r = await x('node', ['-e', 'process.exit(1)'])
      expect(r.exitCode).toBe(1)
      // tinyexec default: does NOT throw on non-zero
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    await useCassette(cassettePath, async () => {
      const r = await x('node', ['-e', 'process.exit(1)'])
      expect(r.exitCode).toBe(1)
    })
  })

  test('throwOnError throws on replay when exit code is non-zero', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'node-fail-throw.json')

    await useCassette(cassettePath, async () => {
      // Record run with throwOnError - real tinyexec throws
      await expect(
        x('node', ['-e', 'process.exit(1)'], { throwOnError: true }),
      ).rejects.toBeDefined()
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    await useCassette(cassettePath, async () => {
      // Replay run with throwOnError - synthesized error
      await expect(x('node', ['-e', 'process.exit(1)'], { throwOnError: true })).rejects.toThrow(
        /non-zero code: 1/,
      )
    })
  })

  test('record stdout with newlines, replay preserves them', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'node-multiline.json')

    let recordedStdout = ''
    await useCassette(cassettePath, async () => {
      const r = await x('node', ['-e', 'console.log("a"); console.log("b"); console.log("c")'])
      // tinyexec preserves trailing newline from `console.log("c")`
      expect(r.stdout).toBe('a\nb\nc\n')
      expect(r.exitCode).toBe(0)
      recordedStdout = r.stdout
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    await useCassette(cassettePath, async () => {
      const r = await x('node', ['-e', 'console.log("a"); console.log("b"); console.log("c")'])
      expect(r.stdout).toBe(recordedStdout)
    })
  })
})
