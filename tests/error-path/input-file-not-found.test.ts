import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CassetteIOError, ShellCassetteError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
const originalMode = process.env.SHELL_CASSETTE_MODE

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  process.env.SHELL_CASSETTE_MODE = 'auto'
})

afterEach(() => {
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

describe('CassetteIOError on missing inputFile', () => {
  const tmp = useTmpDir('sc-input-missing-')

  test('inputFile path does not exist throws CassetteIOError with ENOENT cause', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')
    const missing = path.join(tmp.ref(), 'does-not-exist.txt')

    try {
      await useCassette(cp, async () => {
        await execa('node', ['-e', 'process.stdin.pipe(process.stdout)'], { inputFile: missing })
      })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(CassetteIOError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain(missing)
      // ENOENT cause is preserved on the .cause property.
      const cause = (e as CassetteIOError).cause as NodeJS.ErrnoException | undefined
      expect(cause).toBeDefined()
      expect(cause?.code).toBe('ENOENT')
    }
  })
})
