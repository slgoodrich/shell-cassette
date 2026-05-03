import { describe, expect, test } from 'vitest'

// captureResult is internal — its module is intentionally not in
// package.json's exports map, so imports go through the source path
// directly. Pure-function unit test bypasses the wrapper layer entirely.
import { captureResult } from '../../src/execa-capture.js'

describe('execa captureResult: optional flag fields', () => {
  test('reads all five flags when present and true', () => {
    const r = captureResult(
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
    const r = captureResult({ stdout: '', stderr: '', exitCode: 0 }, 1)
    expect(r.failed).toBe(false)
    expect(r.timedOut).toBe(false)
    expect(r.isMaxBuffer).toBe(false)
    expect(r.isForcefullyTerminated).toBe(false)
    expect(r.isGracefullyCanceled).toBe(false)
  })

  test('non-true truthy values (e.g. truthy strings) coerce to false', () => {
    // execa types these as boolean. The === true idiom guards against any
    // accidental string-leaks from real execa shape changes.
    const r = captureResult(
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

describe('execa captureResult: killed (#129)', () => {
  test('killed=true on raw records killed=true', () => {
    const r = captureResult(
      { stdout: '', stderr: '', exitCode: 0, signal: 'SIGTERM', killed: true },
      1,
    )
    expect(r.killed).toBe(true)
    expect(r.signal).toBe('SIGTERM')
  })

  test('signal !== null without killed records killed=false (external signal)', () => {
    // External SIGTERM (not via subprocess.kill()) — execa exposes
    // signal !== null but killed === false. The capture must preserve
    // that distinction so synth does not report killed=true.
    const r = captureResult(
      { stdout: '', stderr: '', exitCode: 0, signal: 'SIGTERM', killed: false },
      1,
    )
    expect(r.killed).toBe(false)
    expect(r.signal).toBe('SIGTERM')
  })

  test('absent killed defaults to false', () => {
    const r = captureResult({ stdout: '', stderr: '', exitCode: 0 }, 1)
    expect(r.killed).toBe(false)
  })
})
