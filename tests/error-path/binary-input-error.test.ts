import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { BinaryInputError, ShellCassetteError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { NODE_ECHO_STDIN } from '../helpers/subprocess-targets.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

// Lone 0xC3 followed by 0x28 is an invalid UTF-8 sequence (0xC3 expects a
// continuation byte in 0x80-0xBF, and 0x28 is outside that range).
const INVALID_UTF8 = Buffer.from([0xc3, 0x28])

describe('BinaryInputError on inputFile', () => {
  const tmp = useTmpDir('sc-binary-input-')

  test('record path: non-UTF-8 inputFile throws BinaryInputError', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')
    const fixture = path.join(tmp.ref(), 'binary.bin')
    await writeFile(fixture, INVALID_UTF8)

    try {
      await useCassette(cp, async () => {
        await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
      })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(BinaryInputError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain(fixture)
    }
  })

  test('replay path: swap UTF-8 fixture for binary, BinaryInputError fires before matcher', async () => {
    const cp = path.join(tmp.ref(), 'replay-swap.json')
    const fixture = path.join(tmp.ref(), 'swap.txt')

    // Record with a UTF-8 fixture so a recording exists.
    await writeFile(fixture, 'utf-8 content', 'utf8')
    await useCassette(cp, async () => {
      await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
    })

    // Swap the file for binary content. BuildCall reads the file before
    // the matcher runs, so the binary check fires first; we should see
    // BinaryInputError, NOT ReplayMissError.
    await writeFile(fixture, INVALID_UTF8)

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
      })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(BinaryInputError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain(fixture)
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })
})
