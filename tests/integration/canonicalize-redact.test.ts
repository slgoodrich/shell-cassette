import { describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { defaultCanonicalize, MatcherState } from '../../src/matcher.js'
import { callOf, recordingOf } from '../helpers/fixtures.js'

describe('canonicalize-time redact for args', () => {
  test('cassette args with counter-tagged placeholder match fresh call with raw credential', () => {
    const cassetteCall = callOf('curl', [
      'Authorization: Bearer <redacted:args:github-pat-classic:1>',
    ])
    const freshCall = callOf('curl', [
      'Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
    ])
    const cassetteCanon = defaultCanonicalize(cassetteCall, DEFAULT_CONFIG.redact)
    const freshCanon = defaultCanonicalize(freshCall, DEFAULT_CONFIG.redact)
    expect(cassetteCanon).toEqual(freshCanon)
  })

  test('two different real credentials canonicalize to same form (both redacted to placeholder)', () => {
    const a = callOf('curl', ['Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'])
    const b = callOf('curl', ['Authorization: Bearer ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'])
    const ac = defaultCanonicalize(a, DEFAULT_CONFIG.redact)
    const bc = defaultCanonicalize(b, DEFAULT_CONFIG.redact)
    expect(ac).toEqual(bc)
  })

  test('args with NO credential do not get touched by redact (idempotent on benign args)', () => {
    const call = callOf('echo', ['hello', 'world'])
    const canon = defaultCanonicalize(call, DEFAULT_CONFIG.redact)
    expect(canon.args).toEqual(['hello', 'world'])
  })

  test('counter-strip applies regardless of redactConfig (idempotent on stripped form)', () => {
    const cassetteCall = callOf('curl', [
      'Authorization: Bearer <redacted:args:github-pat-classic:5>',
    ])
    const canon = defaultCanonicalize(cassetteCall, DEFAULT_CONFIG.redact)
    expect(canon.args).toEqual(['Authorization: Bearer <redacted:args:github-pat-classic>'])
  })

  test('MatcherState matches a stored cassette with placeholder against a fresh call with real credential', () => {
    const recording = recordingOf(
      'curl',
      ['-H', 'Authorization: Bearer <redacted:args:github-pat-classic:1>'],
      'ok',
      { stderrLines: [], durationMs: 100 },
    )
    recording.redactions = [{ rule: 'github-pat-classic', source: 'args', count: 1 }]

    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)

    const freshCall = callOf('curl', [
      '-H',
      'Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
    ])
    expect(matcher.findMatch(freshCall)).toBe(recording)
  })

  test('MatcherState does NOT match a fresh call with no credential against a cassette with one', () => {
    const recording = recordingOf(
      'curl',
      ['-H', 'Authorization: Bearer <redacted:args:github-pat-classic:1>'],
      '',
      { stdoutLines: [], stderrLines: [], durationMs: 100 },
    )
    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)
    const freshCall = callOf('curl', ['-H', 'Authorization: NoCredHere'])
    expect(matcher.findMatch(freshCall)).toBe(null)
  })

  test('two fresh calls with different credentials of the same rule: first matches, second is consumed', () => {
    const recording = recordingOf(
      'curl',
      ['Authorization: Bearer <redacted:args:github-pat-classic:1>'],
      '',
      { stdoutLines: [], stderrLines: [] },
    )
    recording.redactions = [{ rule: 'github-pat-classic', source: 'args', count: 1 }]
    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)

    const call1 = callOf('curl', ['Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'])
    const call2 = callOf('curl', ['Authorization: Bearer ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'])
    expect(matcher.findMatch(call1)).toBe(recording)
    // Second call: same canonical form, but recording already consumed
    expect(matcher.findMatch(call2)).toBe(null)
  })

  test('canonicalize integrates with existing tmp-path normalization', () => {
    // Combination: tmp path AND credential in same arg
    const call = callOf('curl', [
      '/tmp/test-abc/file.txt --header Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
    ])
    const canon = defaultCanonicalize(call, DEFAULT_CONFIG.redact)
    // Both transforms applied: <tmp> for the path, placeholder for the credential
    expect(canon.args?.[0]).toContain('<tmp>')
    expect(canon.args?.[0]).toContain('<redacted:args:github-pat-classic>')
  })

  test('fresh-call args canonicalize without raw credential when redactConfig is forwarded', () => {
    // The buildReplayMissError fix in wrapper.ts forwards redactConfig to
    // canonicalize so the stringified canonical form (used in the error
    // message text) is credential-free. This test verifies the underlying
    // property: when redactConfig is forwarded, fresh-call args canonicalize
    // to placeholder form, not raw credential. The buildReplayMissError
    // fix is then a thin wrapper around this guarantee.
    const recording = recordingOf(
      'curl',
      ['-H', 'Authorization: Bearer <redacted:args:github-pat-classic:1>'],
      '',
      { stdoutLines: [], stderrLines: [] },
    )
    recording.redactions = [{ rule: 'github-pat-classic', source: 'args', count: 1 }]
    const matcher = new MatcherState([recording], defaultCanonicalize, DEFAULT_CONFIG.redact)

    // Different command so it won't match (credential is still present in args).
    const freshCall = callOf('wget', [
      '-H',
      'Authorization: Bearer ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
    ])
    expect(matcher.findMatch(freshCall)).toBe(null)

    // Verify the canonical form that buildReplayMissError would stringify is credential-free.
    const canonical = defaultCanonicalize(freshCall, DEFAULT_CONFIG.redact)
    const stringified = JSON.stringify(canonical)
    expect(stringified).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
    expect(stringified).toContain('<redacted:args:github-pat-classic>')
  })
})
