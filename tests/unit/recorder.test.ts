import { describe, expect, test } from 'vitest'
import { record } from '../../src/recorder.js'
import type { Call, CassetteSession, Result } from '../../src/types.js'

const baseSession = (): CassetteSession => ({
  name: 'test',
  path: '/tmp/x.json',
  scopeDefault: 'auto',
  loadedFile: null,
  matcher: null,
  newRecordings: [],
  redactedKeys: [],
  warnings: [],
})

const callOf = (env: Record<string, string> = {}): Call => ({
  command: 'git',
  args: ['status'],
  cwd: null,
  env,
  stdin: null,
})

const resultOf = (): Result => ({
  stdoutLines: ['ok', ''],
  stderrLines: [''],
  allLines: null,
  exitCode: 0,
  signal: null,
  durationMs: 5,
})

describe('record', () => {
  test('appends a recording to session.newRecordings', () => {
    const session = baseSession()
    record(callOf(), resultOf(), session, { redactEnvKeys: [] })
    expect(session.newRecordings).toHaveLength(1)
    expect(session.newRecordings[0]?.call.command).toBe('git')
  })

  test('redacts env in the appended recording', () => {
    const session = baseSession()
    const call = callOf({ MY_TOKEN: 'secret', SAFE: 'public' })
    record(call, resultOf(), session, { redactEnvKeys: [] })
    expect(session.newRecordings[0]?.call.env.MY_TOKEN).toBe('<redacted>')
    expect(session.newRecordings[0]?.call.env.SAFE).toBe('public')
  })
})
