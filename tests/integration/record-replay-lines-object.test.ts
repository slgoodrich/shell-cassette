import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
const originalMode = process.env.SHELL_CASSETTE_MODE

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  // Pin auto so CI=true on the runner does not force replay-strict.
  process.env.SHELL_CASSETTE_MODE = 'auto'
})

afterEach(() => {
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

// Two-line target on each stream so we can tell array-form (length 2) from
// string-form (a single string with one '\n'). `lines` is NOT part of the
// matcher's canonical form, so the same recording can be replayed under any
// `lines` shape.
const TWO_LINE_BOTH_STREAMS = [
  '-e',
  'console.log("a"); console.log("b"); console.error("c"); console.error("d")',
]

describe('e2e record + replay with lines object form', () => {
  const tmp = useTmpDir('sc-lines-object-')

  test('lines: { stdout: true, stderr: false } gives array stdout, string stderr on replay', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    // Record with the object form. We compare the recorded values against
    // what real execa returned, then re-run under replay and confirm the
    // synthesized result has the same shape.
    let recordedStdout: unknown
    let recordedStderr: unknown
    await useCassette(cp, async () => {
      const r = await execa('node', TWO_LINE_BOTH_STREAMS, {
        lines: { stdout: true, stderr: false },
      } as never)
      recordedStdout = r.stdout
      recordedStderr = r.stderr
      expect(Array.isArray(r.stdout)).toBe(true)
      expect(typeof r.stderr).toBe('string')
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa('node', TWO_LINE_BOTH_STREAMS, {
          lines: { stdout: true, stderr: false },
        } as never)
        expect(r.stdout).toEqual(recordedStdout)
        expect(r.stderr).toEqual(recordedStderr)
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })

  test('lines: { all: true } + all: true: result.all is array on both record and replay', async () => {
    const cp = path.join(tmp.ref(), 'all.json')

    let recordedAll: unknown
    await useCassette(cp, async () => {
      const r = await execa('node', TWO_LINE_BOTH_STREAMS, {
        all: true,
        lines: { all: true },
      } as never)
      recordedAll = (r as unknown as { all: unknown }).all
      expect(Array.isArray(recordedAll)).toBe(true)
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa('node', TWO_LINE_BOTH_STREAMS, {
          all: true,
          lines: { all: true },
        } as never)
        expect((r as unknown as { all: unknown }).all).toEqual(recordedAll)
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })

  test('lines: { fd1: true } round-trips: array stdout on both record and replay', async () => {
    // Realistic pattern: same `lines` shape on record and replay. Cross-mode
    // replay (record with one shape, replay with another) is not exercised
    // here because `toLines` does not preserve the array-vs-string origin
    // when the string lacks a trailing newline; mixing modes runs into a
    // pre-existing edge in the cassette format that is out of scope here.
    const cp = path.join(tmp.ref(), 'fd1.json')

    let recordedStdout: unknown
    await useCassette(cp, async () => {
      const r = await execa('node', TWO_LINE_BOTH_STREAMS, {
        lines: { fd1: true },
      } as never)
      recordedStdout = r.stdout
      expect(Array.isArray(recordedStdout)).toBe(true)
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa('node', TWO_LINE_BOTH_STREAMS, {
          lines: { fd1: true },
        } as never)
        expect(r.stdout).toEqual(recordedStdout)
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })
})
