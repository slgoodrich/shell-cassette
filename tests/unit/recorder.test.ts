import { describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { record } from '../../src/recorder.js'
import type { Call, CassetteSession } from '../../src/types.js'
import { makeResult } from '../helpers/recording.js'

const baseSession = (): CassetteSession => ({
  name: 'test',
  path: '/tmp/x.json',
  scopeDefault: 'auto',
  loadedFile: null,
  matcher: null,
  canonicalize: DEFAULT_CONFIG.canonicalize,
  redactConfig: DEFAULT_CONFIG.redact,
  redactEnabled: true,
  redactCounters: new Map(),
  redactionEntries: [],
  newRecordings: [],
  warnings: [],
})

const callOf = (env: Record<string, string> = {}): Call => ({
  command: 'git',
  args: ['status'],
  cwd: null,
  env,
  stdin: null,
})

const resultOf = () => makeResult({ stdoutLines: ['ok', ''], stderrLines: [''], durationMs: 5 })

describe('record', () => {
  test('appends a recording to session.newRecordings', () => {
    const session = baseSession()
    record(callOf(), resultOf(), session)
    expect(session.newRecordings).toHaveLength(1)
    expect(session.newRecordings[0]?.call.command).toBe('git')
  })

  test('redacts env in the appended recording via env-key-match rule', () => {
    const session = baseSession()
    const call = callOf({ MY_TOKEN: 'secret', SAFE: 'public' })
    record(call, resultOf(), session)
    expect(session.newRecordings[0]?.call.env.MY_TOKEN).toBe('<redacted:env:env-key-match:1>')
    expect(session.newRecordings[0]?.call.env.SAFE).toBe('public')
  })

  test('redactEnabled: false bypasses pipeline', () => {
    const session = baseSession()
    session.redactEnabled = false
    const call = callOf({ MY_TOKEN: 'secret' })
    record(call, resultOf(), session)
    expect(session.newRecordings[0]?.call.env.MY_TOKEN).toBe('secret')
    expect(session.newRecordings[0]?.redactions).toEqual([])
  })
})
