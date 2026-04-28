import { describe, expect, test } from 'vitest'
import { record } from '../../src/recorder.js'
import { seedCountersFromCassette } from '../../src/redact-pipeline.js'
import type { Call, Result } from '../../src/types.js'
import {
  SAMPLE_AWS_ACCESS_KEY_ID,
  SAMPLE_GITHUB_PAT_CLASSIC,
  SAMPLE_GITHUB_PAT_CLASSIC_2,
} from '../helpers/credential-fixtures.js'
import { makeResult } from '../helpers/recording.js'
import { makeSession } from '../helpers/session.js'

const benignResult: Result = makeResult({ durationMs: 100 })

describe('recorder applies redaction across all 5 sources', () => {
  test('env value with curated env-key match is redacted via env-key rule', () => {
    const session = makeSession()
    const call: Call = {
      command: 'curl',
      args: [],
      cwd: null,
      env: { GH_TOKEN: SAMPLE_GITHUB_PAT_CLASSIC },
      stdin: null,
    }
    record(call, benignResult, session)
    const stored = session.newRecordings[0]
    expect(stored?.call.env.GH_TOKEN).toBe('<redacted:env:env-key-match:1>')
  })

  test('env value with no curated key match but bundled pattern: redacted by pattern', () => {
    const session = makeSession()
    const call: Call = {
      command: 'curl',
      args: [],
      cwd: null,
      env: { CONFIG_BLOB: `prefix ${SAMPLE_GITHUB_PAT_CLASSIC} suffix` },
      stdin: null,
    }
    record(call, benignResult, session)
    const stored = session.newRecordings[0]
    expect(stored?.call.env.CONFIG_BLOB).toBe('prefix <redacted:env:github-pat-classic:1> suffix')
  })

  test('args containing credential is redacted with counter', () => {
    const session = makeSession()
    const call: Call = {
      command: 'curl',
      args: ['-H', `Authorization: Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`],
      cwd: null,
      env: {},
      stdin: null,
    }
    record(call, benignResult, session)
    const stored = session.newRecordings[0]
    expect(stored?.call.args[1]).toBe('Authorization: Bearer <redacted:args:github-pat-classic:1>')
  })

  test('stdout lines containing credentials are redacted', () => {
    const session = makeSession()
    const result: Result = {
      ...benignResult,
      stdoutLines: ['line 1', `token: ${SAMPLE_GITHUB_PAT_CLASSIC}`, 'line 3'],
    }
    record({ command: 'gh', args: [], cwd: null, env: {}, stdin: null }, result, session)
    const stored = session.newRecordings[0]
    expect(stored?.result.stdoutLines[1]).toBe('token: <redacted:stdout:github-pat-classic:1>')
  })

  test('stderr and allLines also redacted', () => {
    const session = makeSession()
    const result: Result = {
      ...benignResult,
      stderrLines: [`warn: ${SAMPLE_AWS_ACCESS_KEY_ID}`],
      allLines: [`stdout-then-stderr: ${SAMPLE_GITHUB_PAT_CLASSIC}`],
    }
    record({ command: 'gh', args: [], cwd: null, env: {}, stdin: null }, result, session)
    const stored = session.newRecordings[0]
    expect(stored?.result.stderrLines[0]).toBe('warn: <redacted:stderr:aws-access-key-id:1>')
    expect(stored?.result.allLines?.[0]).toBe(
      'stdout-then-stderr: <redacted:allLines:github-pat-classic:1>',
    )
  })

  test('redactions on recording aggregated per (source, rule)', () => {
    const session = makeSession()
    const call: Call = {
      command: 'curl',
      args: [`Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`, `Bearer ${SAMPLE_GITHUB_PAT_CLASSIC_2}`],
      cwd: null,
      env: {},
      stdin: null,
    }
    record(call, benignResult, session)
    const stored = session.newRecordings[0]
    expect(stored?.redactions).toEqual([{ rule: 'github-pat-classic', source: 'args', count: 2 }])
  })

  test('counters are shared across multiple record() calls in a session', () => {
    const session = makeSession()
    const call1: Call = {
      command: 'curl',
      args: [SAMPLE_GITHUB_PAT_CLASSIC],
      cwd: null,
      env: {},
      stdin: null,
    }
    const call2: Call = {
      command: 'curl',
      args: [SAMPLE_GITHUB_PAT_CLASSIC_2],
      cwd: null,
      env: {},
      stdin: null,
    }
    record(call1, benignResult, session)
    record(call2, benignResult, session)
    // Counter continues from where it left off; second recording gets :2
    expect(session.newRecordings[0]?.call.args[0]).toBe('<redacted:args:github-pat-classic:1>')
    expect(session.newRecordings[1]?.call.args[0]).toBe('<redacted:args:github-pat-classic:2>')
  })

  test('counters continue from existing cassette ceiling on auto-additive append', () => {
    const session = makeSession()
    // Simulate a pre-loaded cassette with a placeholder counter of :3
    session.loadedFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        {
          call: {
            command: 'curl',
            args: ['Bearer <redacted:args:github-pat-classic:3>'],
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
          redactions: [{ rule: 'github-pat-classic', source: 'args', count: 3 }],
          suppressed: [],
        },
      ],
    }
    // Seed counters (in production done by wrapper.ts on cassette load)
    const seeded = seedCountersFromCassette(session.loadedFile)
    for (const [k, v] of seeded) {
      session.redactCounters.set(k, v)
    }

    // Record a new call with a fresh PAT; counter should continue at :4
    const call: Call = {
      command: 'curl',
      args: [`Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`],
      cwd: null,
      env: {},
      stdin: null,
    }
    record(call, benignResult, session)
    expect(session.newRecordings[0]?.call.args[0]).toBe(
      'Bearer <redacted:args:github-pat-classic:4>',
    )
  })

  test('redactEnabled: false bypasses pipeline', () => {
    const session = makeSession()
    session.redactEnabled = false
    const call: Call = {
      command: 'curl',
      args: [`Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`],
      cwd: null,
      env: { GH_TOKEN: SAMPLE_GITHUB_PAT_CLASSIC },
      stdin: null,
    }
    record(call, benignResult, session)
    const stored = session.newRecordings[0]
    expect(stored?.call.args[0]).toBe(`Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`)
    expect(stored?.call.env.GH_TOKEN).toBe(SAMPLE_GITHUB_PAT_CLASSIC)
    expect(stored?.redactions).toEqual([])
  })
})
