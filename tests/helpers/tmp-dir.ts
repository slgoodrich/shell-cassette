import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach } from 'vitest'

/**
 * Registers beforeEach/afterEach hooks that create a fresh temp directory
 * before each test and remove it after. Returns a ref object whose `.ref()`
 * getter returns the current temp dir path.
 *
 * Usage:
 *   const tmp = useTmpDir()
 *   test('...', async () => {
 *     const dir = tmp.ref()
 *     // use dir
 *   })
 */
export function useTmpDir(prefix = 'shell-cassette-test-'): { ref: () => string } {
  let current = ''

  beforeEach(async () => {
    current = await mkdtemp(path.join(tmpdir(), prefix))
  })

  afterEach(async () => {
    await rm(current, { recursive: true, force: true })
    current = ''
  })

  return {
    ref(): string {
      return current
    },
  }
}
