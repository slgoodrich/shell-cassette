import { describe, expect, test, vi } from 'vitest'
import { defaultMatcher, MatcherState } from '../../src/matcher.js'
import type { Call, Recording } from '../../src/types.js'

const callOf = (command: string, args: string[]): Call => ({
  command,
  args,
  cwd: null,
  env: {},
  stdin: null,
})

const recordingOf = (command: string, args: string[], stdout = ''): Recording => ({
  call: callOf(command, args),
  result: {
    stdoutLines: [stdout, ''],
    stderrLines: [''],
    exitCode: 0,
    signal: null,
    durationMs: 1,
  },
})

describe('defaultMatcher', () => {
  test('matches on command + deep-equal args', () => {
    const c = callOf('git', ['status'])
    const r = recordingOf('git', ['status'])
    expect(defaultMatcher(c, r)).toBe(true)
  })

  test('does not match on different command', () => {
    expect(defaultMatcher(callOf('git', ['status']), recordingOf('hg', ['status']))).toBe(false)
  })

  test('does not match on different args', () => {
    expect(defaultMatcher(callOf('git', ['status']), recordingOf('git', ['log']))).toBe(false)
  })

  test('args order matters', () => {
    expect(defaultMatcher(callOf('git', ['a', 'b']), recordingOf('git', ['b', 'a']))).toBe(false)
  })
})

describe('MatcherState sequential consumption', () => {
  test('returns null when no recordings', () => {
    const m = new MatcherState([], defaultMatcher)
    expect(m.findMatch(callOf('git', []))).toBeNull()
  })

  test('returns first match for first call, second match for second call', () => {
    const recs = [recordingOf('git', ['status'], 'first'), recordingOf('git', ['status'], 'second')]
    const m = new MatcherState(recs, defaultMatcher)
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('first')
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('second')
  })

  test('returns null when consumption exhausted', () => {
    const recs = [recordingOf('git', ['status'])]
    const m = new MatcherState(recs, defaultMatcher)
    m.findMatch(callOf('git', ['status']))
    expect(m.findMatch(callOf('git', ['status']))).toBeNull()
  })

  test('different tuples have independent counters', () => {
    const recs = [
      recordingOf('git', ['status'], 's1'),
      recordingOf('git', ['log'], 'l1'),
      recordingOf('git', ['status'], 's2'),
    ]
    const m = new MatcherState(recs, defaultMatcher)
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('s1')
    expect(m.findMatch(callOf('git', ['log']))?.result.stdoutLines[0]).toBe('l1')
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('s2')
  })

  test('logs ambiguity warning when multiple unconsumed recordings could match', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const recs = [recordingOf('git', ['status'], 'a'), recordingOf('git', ['status'], 'b')]
      const m = new MatcherState(recs, defaultMatcher)
      m.findMatch(callOf('git', ['status']))
      const warnCalls = stderrSpy.mock.calls
        .map((c) => c[0] as string)
        .filter((s) => s.includes('ambiguous'))
      expect(warnCalls.length).toBeGreaterThan(0)
    } finally {
      stderrSpy.mockRestore()
    }
  })

  test('uses custom matcher function', () => {
    const recs = [recordingOf('git', ['status'])]
    const customMatcher = (c: Call, r: Recording) => c.command === r.call.command
    const m = new MatcherState(recs, customMatcher)
    // Custom matcher matches by command alone
    expect(m.findMatch(callOf('git', ['anything']))).not.toBeNull()
  })
})
