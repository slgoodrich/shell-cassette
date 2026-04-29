import { afterEach, beforeEach } from 'vitest'

/**
 * Registers beforeEach/afterEach hooks that swap `process.stdout.write` and
 * `process.stderr.write` for buffered captures, then restores them after
 * each test. Returns getters so individual tests can read what was emitted.
 *
 * Used by unit and integration tests of CLI subcommands. Without this, the
 * subcommand's render output (including potentially-sensitive finding
 * content for review) leaks into the vitest reporter.
 *
 * Usage:
 *   const cli = useCapturedCliOutput()
 *   test('...', async () => {
 *     await runFoo(['--bar'])
 *     expect(cli.stdout()).toContain('expected')
 *     expect(cli.stderr()).toBe('')
 *   })
 */
export function useCapturedCliOutput(): {
  stdout: () => string
  stderr: () => string
} {
  let outBuf: string[] = []
  let errBuf: string[] = []
  const origStdout = process.stdout.write.bind(process.stdout)
  const origStderr = process.stderr.write.bind(process.stderr)

  beforeEach(() => {
    outBuf = []
    errBuf = []
    process.stdout.write = ((s: string) => {
      outBuf.push(s)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((s: string) => {
      errBuf.push(s)
      return true
    }) as typeof process.stderr.write
  })

  afterEach(() => {
    process.stdout.write = origStdout
    process.stderr.write = origStderr
  })

  return {
    stdout: () => outBuf.join(''),
    stderr: () => errBuf.join(''),
  }
}
