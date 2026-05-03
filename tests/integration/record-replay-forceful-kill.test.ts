import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

// POSIX-only: forceKillAfterDelay relies on a SIGTERM-ignoring child.
// Windows has no SIGTERM semantics; the equivalent escalation does not
// exist, so there is no Windows counter-test (nothing to assert).
const isWindows = process.platform === 'win32'

// Ignore SIGTERM and idle. The wrapper's timeout fires SIGTERM, then
// forceKillAfterDelay escalates to SIGKILL. The captured result has
// isForcefullyTerminated: true.
const IGNORE_SIGTERM_THEN_IDLE = [
  '-e',
  "process.on('SIGTERM', () => {}); setTimeout(() => {}, 5000)",
]

describe('record + replay: forceful kill (execa, POSIX-only)', () => {
  const tmp = useTmpDir('sc-forceful-')

  test.skipIf(isWindows)(
    'isForcefullyTerminated captured, replays with matching shape',
    async () => {
      const cp = path.join(tmp.ref(), 'cassette.json')

      await useCassette(cp, async () => {
        const r = await execa('node', IGNORE_SIGTERM_THEN_IDLE, {
          timeout: 100,
          forceKillAfterDelay: 50,
          reject: false,
        })
        expect((r as { isForcefullyTerminated: boolean }).isForcefullyTerminated).toBe(true)
      })

      const cassette = JSON.parse(await readFile(cp, 'utf8'))
      expect(cassette.recordings[0].result.isForcefullyTerminated).toBe(true)

      const prevMode = process.env.SHELL_CASSETTE_MODE
      process.env.SHELL_CASSETTE_MODE = 'replay'
      try {
        await useCassette(cp, async () => {
          const r = await execa('node', IGNORE_SIGTERM_THEN_IDLE, {
            timeout: 100,
            forceKillAfterDelay: 50,
            reject: false,
          })
          expect((r as { isForcefullyTerminated: boolean }).isForcefullyTerminated).toBe(true)
        })
      } finally {
        restoreEnv('SHELL_CASSETTE_MODE', prevMode)
      }
    },
  )
})
