import { describe, expect, test, vi } from 'vitest'
import { defaultCanonicalize, MatcherState } from '../../src/matcher.js'
import type { Call, Canonicalize, Recording } from '../../src/types.js'

const callOf = (command: string, args: string[], extra: Partial<Call> = {}): Call => ({
  command,
  args,
  cwd: null,
  env: {},
  stdin: null,
  ...extra,
})

const recordingOf = (command: string, args: string[], stdout = ''): Recording => ({
  call: callOf(command, args),
  result: {
    stdoutLines: [stdout, ''],
    stderrLines: [''],
    allLines: null,
    exitCode: 0,
    signal: null,
    durationMs: 1,
    aborted: false,
  },
})

describe('defaultCanonicalize', () => {
  test('includes command and args', () => {
    const canonical = defaultCanonicalize(callOf('git', ['status']))
    expect(canonical.command).toBe('git')
    expect(canonical.args).toEqual(['status'])
  })

  test('omits cwd, env, stdin from canonical form', () => {
    const canonical = defaultCanonicalize(
      callOf('git', ['status'], { cwd: '/some/dir', env: { FOO: 'bar' } }),
    )
    expect(canonical.cwd).toBeUndefined()
    expect(canonical.env).toBeUndefined()
    expect(canonical.stdin).toBeUndefined()
  })

  test('normalizes mkdtemp paths in args', () => {
    const canonical = defaultCanonicalize(
      callOf('git', ['remote', 'set-url', 'origin', '/tmp/test-abc/remote.git']),
    )
    expect(canonical.args).toEqual(['remote', 'set-url', 'origin', '<tmp>/remote.git'])
  })

  test('is deterministic — same input produces same output', () => {
    const c = callOf('git', ['log'])
    expect(defaultCanonicalize(c)).toEqual(defaultCanonicalize(c))
  })
})

describe('MatcherState — basic matching', () => {
  test('returns null when no recordings', () => {
    const m = new MatcherState([], defaultCanonicalize)
    expect(m.findMatch(callOf('git', []))).toBeNull()
  })

  test('matches on command + args', () => {
    const recs = [recordingOf('git', ['status'], 'output')]
    const m = new MatcherState(recs, defaultCanonicalize)
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('output')
  })

  test('does not match on different command', () => {
    const recs = [recordingOf('git', ['status'])]
    const m = new MatcherState(recs, defaultCanonicalize)
    expect(m.findMatch(callOf('hg', ['status']))).toBeNull()
  })

  test('does not match on different args', () => {
    const recs = [recordingOf('git', ['status'])]
    const m = new MatcherState(recs, defaultCanonicalize)
    expect(m.findMatch(callOf('git', ['log']))).toBeNull()
  })

  test('args order matters under default', () => {
    const recs = [recordingOf('git', ['a', 'b'])]
    const m = new MatcherState(recs, defaultCanonicalize)
    expect(m.findMatch(callOf('git', ['b', 'a']))).toBeNull()
  })

  test('matches when canonical forms equal even if raw args differ (tmp normalization)', () => {
    const recs = [
      recordingOf('git', ['remote', 'set-url', 'origin', '/tmp/test-RECORD/remote.git']),
    ]
    const m = new MatcherState(recs, defaultCanonicalize)
    const matched = m.findMatch(
      callOf('git', ['remote', 'set-url', 'origin', '/tmp/test-REPLAY/remote.git']),
    )
    expect(matched).not.toBeNull()
  })
})

describe('MatcherState — sequential consumption', () => {
  test('first call gets first match, second call gets second match', () => {
    const recs = [recordingOf('git', ['status'], 'first'), recordingOf('git', ['status'], 'second')]
    const m = new MatcherState(recs, defaultCanonicalize)
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('first')
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('second')
  })

  test('returns null when consumption exhausted', () => {
    const recs = [recordingOf('git', ['status'])]
    const m = new MatcherState(recs, defaultCanonicalize)
    m.findMatch(callOf('git', ['status']))
    expect(m.findMatch(callOf('git', ['status']))).toBeNull()
  })

  test('different tuples have independent counters', () => {
    const recs = [
      recordingOf('git', ['status'], 's1'),
      recordingOf('git', ['log'], 'l1'),
      recordingOf('git', ['status'], 's2'),
    ]
    const m = new MatcherState(recs, defaultCanonicalize)
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('s1')
    expect(m.findMatch(callOf('git', ['log']))?.result.stdoutLines[0]).toBe('l1')
    expect(m.findMatch(callOf('git', ['status']))?.result.stdoutLines[0]).toBe('s2')
  })
})

describe('MatcherState — ambiguity warning', () => {
  test('logs warning when multiple unconsumed recordings could match', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const recs = [recordingOf('git', ['status'], 'a'), recordingOf('git', ['status'], 'b')]
      const m = new MatcherState(recs, defaultCanonicalize)
      m.findMatch(callOf('git', ['status']))
      const warnCalls = stderrSpy.mock.calls
        .map((c) => c[0] as string)
        .filter((s) => s.includes('ambiguous'))
      expect(warnCalls.length).toBeGreaterThan(0)
    } finally {
      stderrSpy.mockRestore()
    }
  })
})

describe('MatcherState — custom canonicalize', () => {
  test('uses provided canonicalize fn (e.g., command-only matching)', () => {
    const commandOnly: Canonicalize = (call) => ({ command: call.command })
    const recs = [recordingOf('git', ['status'])]
    const m = new MatcherState(recs, commandOnly)
    expect(m.findMatch(callOf('git', ['anything']))).not.toBeNull()
  })

  test('caches canonical forms at construction (canonicalize called once per recording)', () => {
    const calls: Call[] = []
    const tracking: Canonicalize = (c) => {
      calls.push(c)
      return { command: c.command, args: c.args }
    }
    const recs = [recordingOf('git', ['a']), recordingOf('git', ['b'])]
    new MatcherState(recs, tracking)
    expect(calls).toHaveLength(2)
  })
})
