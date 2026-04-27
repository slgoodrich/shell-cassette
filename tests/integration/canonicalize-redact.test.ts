import { describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { defaultCanonicalize, MatcherState } from '../../src/matcher.js'
import type { Call, Recording } from '../../src/types.js'

describe('canonicalize-time redact for args', () => {
  test('cassette args with counter-tagged placeholder match fresh call with raw credential', () => {
    const cassetteCall: Call = {
      command: 'curl',
      args: ['Authorization: Bearer <redacted:args:github-pat-classic:1>'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const freshCall: Call = {
      command: 'curl',
      args: ['Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const cassetteCanon = defaultCanonicalize(cassetteCall, { redactConfig: DEFAULT_CONFIG.redact })
    const freshCanon = defaultCanonicalize(freshCall, { redactConfig: DEFAULT_CONFIG.redact })
    expect(cassetteCanon).toEqual(freshCanon)
  })

  test('two different real credentials canonicalize to same form (both redacted to placeholder)', () => {
    const a: Call = {
      command: 'curl',
      args: ['Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const b: Call = {
      command: 'curl',
      args: ['Authorization: Bearer ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const ac = defaultCanonicalize(a, { redactConfig: DEFAULT_CONFIG.redact })
    const bc = defaultCanonicalize(b, { redactConfig: DEFAULT_CONFIG.redact })
    expect(ac).toEqual(bc)
  })

  test('args with NO credential do not get touched by redact (idempotent on benign args)', () => {
    const call: Call = {
      command: 'echo',
      args: ['hello', 'world'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const canon = defaultCanonicalize(call, { redactConfig: DEFAULT_CONFIG.redact })
    expect(canon.args).toEqual(['hello', 'world'])
  })

  test('canonicalize without redactConfig: counter-strip still applies (idempotent on stripped form)', () => {
    const cassetteCall: Call = {
      command: 'curl',
      args: ['Authorization: Bearer <redacted:args:github-pat-classic:5>'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const canon = defaultCanonicalize(cassetteCall)
    expect(canon.args).toEqual(['Authorization: Bearer <redacted:args:github-pat-classic>'])
  })

  test('MatcherState matches a stored cassette with placeholder against a fresh call with real credential', () => {
    const recording: Recording = {
      call: {
        command: 'curl',
        args: ['-H', 'Authorization: Bearer <redacted:args:github-pat-classic:1>'],
        cwd: null,
        env: {},
        stdin: null,
      },
      result: {
        stdoutLines: ['ok'],
        stderrLines: [],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 100,
        aborted: false,
      },
      redactions: [{ rule: 'github-pat-classic', source: 'args', count: 1 }],
    }

    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)

    const freshCall: Call = {
      command: 'curl',
      args: ['-H', 'Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const matched = matcher.findMatch(freshCall)
    expect(matched).toBe(recording)
  })

  test('MatcherState does NOT match a fresh call with no credential against a cassette with one', () => {
    const recording: Recording = {
      call: {
        command: 'curl',
        args: ['-H', 'Authorization: Bearer <redacted:args:github-pat-classic:1>'],
        cwd: null,
        env: {},
        stdin: null,
      },
      result: {
        stdoutLines: [],
        stderrLines: [],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 100,
        aborted: false,
      },
      redactions: [],
    }
    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)
    const freshCall: Call = {
      command: 'curl',
      args: ['-H', 'Authorization: NoCredHere'],
      cwd: null,
      env: {},
      stdin: null,
    }
    expect(matcher.findMatch(freshCall)).toBe(null)
  })

  test('two fresh calls with different credentials of the same rule: first matches, second is consumed', () => {
    const recording: Recording = {
      call: {
        command: 'curl',
        args: ['Authorization: Bearer <redacted:args:github-pat-classic:1>'],
        cwd: null,
        env: {},
        stdin: null,
      },
      result: {
        stdoutLines: [],
        stderrLines: [],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
        aborted: false,
      },
      redactions: [{ rule: 'github-pat-classic', source: 'args', count: 1 }],
    }
    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)

    const call1: Call = {
      command: 'curl',
      args: ['Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'],
      cwd: null,
      env: {},
      stdin: null,
    }
    const call2: Call = {
      command: 'curl',
      args: ['Authorization: Bearer ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'],
      cwd: null,
      env: {},
      stdin: null,
    }
    expect(matcher.findMatch(call1)).toBe(recording)
    // Second call: same canonical form, but recording already consumed
    expect(matcher.findMatch(call2)).toBe(null)
  })

  test('canonicalize integrates with existing tmp-path normalization', () => {
    // Combination: tmp path AND credential in same arg
    const call: Call = {
      command: 'curl',
      args: [
        '/tmp/test-abc/file.txt --header Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
      ],
      cwd: null,
      env: {},
      stdin: null,
    }
    const canon = defaultCanonicalize(call, { redactConfig: DEFAULT_CONFIG.redact })
    // Both transforms applied: <tmp> for the path, placeholder for the credential
    expect(canon.args?.[0]).toContain('<tmp>')
    expect(canon.args?.[0]).toContain('<redacted:args:github-pat-classic>')
  })

  test('replay-miss error message does not contain raw credential from fresh-call args', () => {
    // Regression guard for the buildReplayMissError credential-leak fix.
    // The error message is built from session.canonicalize(call, opts) where
    // opts carries redactConfig. This test verifies the canonical form (which
    // is what gets stringified into the error message) is credential-free.
    const recording: Recording = {
      call: {
        command: 'curl',
        args: ['-H', 'Authorization: Bearer <redacted:args:github-pat-classic:1>'],
        cwd: null,
        env: {},
        stdin: null,
      },
      result: {
        stdoutLines: [],
        stderrLines: [],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
        aborted: false,
      },
      redactions: [{ rule: 'github-pat-classic', source: 'args', count: 1 }],
    }
    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)

    // Different command so it won't match (credential is still present in args).
    const freshCall: Call = {
      command: 'wget',
      args: ['-H', 'Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'],
      cwd: null,
      env: {},
      stdin: null,
    }
    expect(matcher.findMatch(freshCall)).toBe(null)

    // Verify the canonical form that buildReplayMissError would stringify is credential-free.
    const canonical = defaultCanonicalize(freshCall, { redactConfig: DEFAULT_CONFIG.redact })
    const stringified = JSON.stringify(canonical)
    expect(stringified).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
    expect(stringified).toContain('<redacted:args:github-pat-classic>')
  })
})
