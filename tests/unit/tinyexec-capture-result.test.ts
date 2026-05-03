import { describe, expect, test } from 'vitest'

import { captureResult } from '../../src/tinyexec-capture.js'

describe('tinyexec captureResult: failed derivation', () => {
  test('plain success (exitCode 0, no kill, no abort): failed false', () => {
    const r = captureResult(
      { stdout: 'ok', stderr: '', exitCode: 0, killed: false, aborted: false },
      1,
    )
    expect(r.failed).toBe(false)
  })

  test('non-zero exit: failed true', () => {
    const r = captureResult(
      { stdout: '', stderr: 'oops', exitCode: 1, killed: false, aborted: false },
      1,
    )
    expect(r.failed).toBe(true)
  })

  test('killed: failed true (signal kill collapses to SIGTERM in this adapter)', () => {
    const r = captureResult(
      { stdout: '', stderr: '', exitCode: 0, killed: true, aborted: false },
      1,
    )
    expect(r.failed).toBe(true)
    expect(r.signal).toBe('SIGTERM')
  })

  test('aborted: failed true', () => {
    const r = captureResult(
      { stdout: '', stderr: '', exitCode: 0, killed: false, aborted: true },
      1,
    )
    expect(r.failed).toBe(true)
    expect(r.aborted).toBe(true)
  })

  test('timedOut and isMaxBuffer not stored (tinyexec does not expose)', () => {
    const r = captureResult(
      { stdout: '', stderr: '', exitCode: 0, killed: false, aborted: false },
      1,
    ) as Record<string, unknown>
    expect(r.timedOut).toBeUndefined()
    expect(r.isMaxBuffer).toBeUndefined()
  })

  test('killed=true on raw records killed=true (#129)', () => {
    const r = captureResult(
      { stdout: '', stderr: '', exitCode: 0, killed: true, aborted: false },
      1,
    )
    expect(r.killed).toBe(true)
    expect(r.signal).toBe('SIGTERM')
  })

  test('killed=false records killed=false even when signal would be derived elsewhere', () => {
    const r = captureResult(
      { stdout: '', stderr: '', exitCode: 0, killed: false, aborted: false },
      1,
    )
    expect(r.killed).toBe(false)
    expect(r.signal).toBeNull()
  })
})
