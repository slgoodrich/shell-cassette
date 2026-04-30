import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { CassetteIOError, ShellCassetteError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { NODE_ECHO_STDIN } from '../helpers/subprocess-targets.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

describe('CassetteIOError on missing inputFile', () => {
  const tmp = useTmpDir('sc-input-missing-')

  test('inputFile path does not exist throws CassetteIOError with ENOENT cause', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')
    const missing = path.join(tmp.ref(), 'does-not-exist.txt')

    try {
      await useCassette(cp, async () => {
        await execa('node', NODE_ECHO_STDIN, { inputFile: missing })
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
