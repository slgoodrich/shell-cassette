// Dogfood: shell-cassette tests itself with the vitest auto-cassette plugin.
// Cassettes are committed under __cassettes__/ so CI replays from disk.
//
// Local re-record: delete the cassette files, then
//   SHELL_CASSETTE_ACK_REDACTION=true npm run test:dogfood
//
// CI replay-strict: set CI=true (forces replay; record paths throw).

import '../../../src/vitest.js'
import { describe, expect, test } from 'vitest'
import { x } from '../../../src/tinyexec.js'

describe('shell-cassette tinyexec dogfood', () => {
  test('replays node version output from cassette', async () => {
    const r = await x('node', ['--version'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/^v\d+\.\d+\.\d+/)
  })

  test('replays multi-line stdout preserving trailing newline', async () => {
    const r = await x('node', ['-e', 'console.log("line1"); console.log("line2")'])
    expect(r.exitCode).toBe(0)
    // tinyexec preserves trailing newlines from console.log. Tolerate \r on
    // Windows-recorded cassettes (Node's stdout path varies by output kind).
    expect(r.stdout).toMatch(/^line1\r?\nline2\r?\n$/)
  })

  test('replays non-zero exit without throwing by default', async () => {
    const r = await x('node', ['-e', 'process.exit(2)'])
    expect(r.exitCode).toBe(2)
    // tinyexec's default does NOT throw on non-zero exit
  })
})
