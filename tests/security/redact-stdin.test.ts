import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { execa } from '../../src/execa.js'
import { record } from '../../src/recorder.js'
import { seedCountersFromCassette } from '../../src/redact-pipeline.js'
import { useCassette } from '../../src/use-cassette.js'
import {
  SAMPLE_GITHUB_PAT_CLASSIC,
  SAMPLE_GITHUB_PAT_CLASSIC_2,
} from '../helpers/credential-fixtures.js'
import { makeResult } from '../helpers/recording.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { makeSession } from '../helpers/session.js'
import { NODE_ECHO_STDIN } from '../helpers/subprocess-targets.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

describe('recorder redacts stdin via the bundle', () => {
  test('GitHub PAT in stdin is replaced with counter-tagged placeholder', () => {
    const session = makeSession()
    record(
      {
        command: 'curl',
        args: [],
        cwd: null,
        env: {},
        stdin: `prefix ${SAMPLE_GITHUB_PAT_CLASSIC} suffix`,
      },
      makeResult(),
      session,
    )
    expect(session.newRecordings[0]?.call.stdin).toBe(
      'prefix <redacted:stdin:github-pat-classic:1> suffix',
    )
    expect(session.newRecordings[0]?.redactions).toEqual([
      { rule: 'github-pat-classic', source: 'stdin', count: 1 },
    ])
  })

  test('multiple PATs in same stdin: counter increments per occurrence', () => {
    const session = makeSession()
    record(
      {
        command: 'curl',
        args: [],
        cwd: null,
        env: {},
        stdin: `${SAMPLE_GITHUB_PAT_CLASSIC} and ${SAMPLE_GITHUB_PAT_CLASSIC_2}`,
      },
      makeResult(),
      session,
    )
    expect(session.newRecordings[0]?.call.stdin).toBe(
      '<redacted:stdin:github-pat-classic:1> and <redacted:stdin:github-pat-classic:2>',
    )
  })

  test('empty-string stdin is preserved verbatim', () => {
    const session = makeSession()
    record({ command: 'curl', args: [], cwd: null, env: {}, stdin: '' }, makeResult(), session)
    expect(session.newRecordings[0]?.call.stdin).toBe('')
    expect(session.newRecordings[0]?.redactions).toEqual([])
  })

  test('null stdin is preserved verbatim and skips the redact step', () => {
    const session = makeSession()
    record({ command: 'curl', args: [], cwd: null, env: {}, stdin: null }, makeResult(), session)
    expect(session.newRecordings[0]?.call.stdin).toBeNull()
    expect(session.newRecordings[0]?.redactions).toEqual([])
  })

  test('custom rule applied to stdin redacts as expected', () => {
    const session = makeSession({
      redactConfig: {
        ...makeSession().redactConfig,
        bundledPatterns: false,
        customPatterns: [{ name: 'my-secret', pattern: /MYSECRET-[A-Z0-9]+/ }],
      },
    })
    record(
      {
        command: 'curl',
        args: [],
        cwd: null,
        env: {},
        stdin: 'value MYSECRET-ABC123 trailing',
      },
      makeResult(),
      session,
    )
    expect(session.newRecordings[0]?.call.stdin).toBe('value <redacted:stdin:my-secret:1> trailing')
  })

  test('redactEnabled: false bypasses stdin redaction', () => {
    const session = makeSession()
    session.redactEnabled = false
    record(
      {
        command: 'curl',
        args: [],
        cwd: null,
        env: {},
        stdin: SAMPLE_GITHUB_PAT_CLASSIC,
      },
      makeResult(),
      session,
    )
    expect(session.newRecordings[0]?.call.stdin).toBe(SAMPLE_GITHUB_PAT_CLASSIC)
    expect(session.newRecordings[0]?.redactions).toEqual([])
  })
})

describe('counter seeding for stdin source', () => {
  test('cassette with <redacted:stdin:gh-pat:N> placeholder seeds counter', () => {
    const seeded = seedCountersFromCassette({
      version: 2,
      recordedBy: null,
      recordings: [
        {
          call: {
            command: 'curl',
            args: [],
            cwd: null,
            env: {},
            stdin: 'token: <redacted:stdin:github-pat-classic:5>',
          },
          result: makeResult(),
          redactions: [],
          suppressed: [],
        },
      ],
    })
    expect(seeded.get('stdin:github-pat-classic')).toBe(5)
  })

  test('next emission continues from seeded ceiling', () => {
    const session = makeSession()
    session.loadedFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        {
          call: {
            command: 'curl',
            args: [],
            cwd: null,
            env: {},
            stdin: 'token: <redacted:stdin:github-pat-classic:3>',
          },
          result: makeResult(),
          redactions: [{ rule: 'github-pat-classic', source: 'stdin', count: 3 }],
          suppressed: [],
        },
      ],
    }
    const seeded = seedCountersFromCassette(session.loadedFile)
    for (const [k, v] of seeded) {
      session.redactCounters.set(k, v)
    }

    record(
      {
        command: 'curl',
        args: [],
        cwd: null,
        env: {},
        stdin: SAMPLE_GITHUB_PAT_CLASSIC,
      },
      makeResult(),
      session,
    )
    // Body has :3 and metadata has count 3; max + 1 = :4
    expect(session.newRecordings[0]?.call.stdin).toBe('<redacted:stdin:github-pat-classic:4>')
  })
})

describe('e2e: stdin credential round-trips redacted in cassette JSON', () => {
  const tmp = useTmpDir('sc-redact-stdin-')

  test('input containing GitHub PAT lands as placeholder in cassette body', async () => {
    const cp = path.join(tmp.ref(), 'redact-stdin.json')
    await useCassette(cp, async () => {
      await execa('node', NODE_ECHO_STDIN, { input: SAMPLE_GITHUB_PAT_CLASSIC })
    })
    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings).toHaveLength(1)
    expect(cassette.recordings[0].call.stdin).toBe('<redacted:stdin:github-pat-classic:1>')
    // Cassette text never contains the raw token, even though the subprocess
    // echoed it to stdout (where redaction also fires for the stdout source).
    const cassetteText = await readFile(cp, 'utf8')
    expect(cassetteText).not.toContain(SAMPLE_GITHUB_PAT_CLASSIC)
    // The stdin entry is in the redaction summary; stdout may also appear
    // because NODE_ECHO_STDIN pipes stdin to stdout.
    expect(cassette.recordings[0]._redactions).toContainEqual({
      rule: 'github-pat-classic',
      source: 'stdin',
      count: 1,
    })
  })
})

describe('logging never includes stdin content', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>
  const originalLog = process.env.SHELL_CASSETTE_LOG

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    delete process.env.SHELL_CASSETTE_LOG
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    if (originalLog === undefined) {
      delete process.env.SHELL_CASSETTE_LOG
    } else {
      process.env.SHELL_CASSETTE_LOG = originalLog
    }
  })

  test('recorder does not log raw stdin value when it contains a credential', () => {
    const session = makeSession()
    record(
      {
        command: 'curl',
        args: [],
        cwd: null,
        env: {},
        stdin: SAMPLE_GITHUB_PAT_CLASSIC,
      },
      makeResult(),
      session,
    )
    // Walk every stderr write the recorder/log made; none may contain the
    // raw token. Per the project rule, log lines about stdin redaction may
    // emit the source label but never the value.
    for (const call of stderrSpy.mock.calls) {
      const text = String(call[0])
      expect(text).not.toContain(SAMPLE_GITHUB_PAT_CLASSIC)
    }
  })
})
