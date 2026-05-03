import { describe, expect, test } from 'vitest'

// captureResult is internal; expose a thin re-export by importing the
// adapter and using a known shape. Pure-function unit test bypasses
// the wrapper layer entirely.
import { _captureResultForTesting } from '../../src/execa.js'

describe('execa captureResult: optional flag fields', () => {
  test('reads all five flags when present and true', () => {
    const r = _captureResultForTesting(
      {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        signal: null,
        isCanceled: false,
        failed: true,
        timedOut: true,
        isMaxBuffer: true,
        isForcefullyTerminated: true,
        isGracefullyCanceled: true,
      },
      42,
    )
    expect(r.failed).toBe(true)
    expect(r.timedOut).toBe(true)
    expect(r.isMaxBuffer).toBe(true)
    expect(r.isForcefullyTerminated).toBe(true)
    expect(r.isGracefullyCanceled).toBe(true)
    expect(r.durationMs).toBe(42)
  })

  test('absent flags default to false (not undefined)', () => {
    const r = _captureResultForTesting({ stdout: '', stderr: '', exitCode: 0 }, 1)
    expect(r.failed).toBe(false)
    expect(r.timedOut).toBe(false)
    expect(r.isMaxBuffer).toBe(false)
    expect(r.isForcefullyTerminated).toBe(false)
    expect(r.isGracefullyCanceled).toBe(false)
  })

  test('non-true truthy values (e.g. truthy strings) coerce to false', () => {
    // execa types these as boolean. The === true idiom guards against any
    // accidental string-leaks from real execa shape changes.
    const r = _captureResultForTesting(
      {
        stdout: '',
        stderr: '',
        exitCode: 1,
        failed: 1 as unknown as boolean,
        timedOut: 'yes' as unknown as boolean,
      },
      1,
    )
    expect(r.failed).toBe(false)
    expect(r.timedOut).toBe(false)
  })
})
