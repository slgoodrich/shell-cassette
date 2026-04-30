import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

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

  test('no-trailing-newline stdout round-trips under lines: true', async () => {
    // process.stdout.write('foo') (no '\n') was previously over-trimmed on
    // replay: the cassette stored ['foo'] (no trailing '' marker), and the
    // synthesize path's slice(0, -1) dropped the only line, returning []
    // instead of ['foo']. The dropTrailingMarker helper now slices only
    // when the last element actually IS the marker.
    const cp = path.join(tmp.ref(), 'no-newline.json')

    let recordedStdout: unknown
    await useCassette(cp, async () => {
      const r = await execa('node', ['-e', 'process.stdout.write("foo")'], {
        lines: true,
      })
      recordedStdout = r.stdout
      expect(r.stdout).toEqual(['foo'])
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa('node', ['-e', 'process.stdout.write("foo")'], {
          lines: true,
        })
        expect(r.stdout).toEqual(recordedStdout)
        expect(r.stdout).toEqual(['foo'])
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })

  test('lines: { fd1: true } round-trips: array stdout on both record and replay', async () => {
    // Realistic pattern: same `lines` shape on record and replay.
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
