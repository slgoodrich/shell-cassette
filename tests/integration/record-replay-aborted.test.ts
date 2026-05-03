import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

const SLEEP_5S = ['-e', 'setTimeout(() => {}, 5000)']

// Tinyexec coverage for aborted-call record/replay is tracked in #126.
// tinyexec's awaited Output drops the OutputApi getters (aborted, killed)
// that live on the pre-await ExecProcess, so the wrapper currently records
// `aborted: false` even on cancelled tinyexec calls. Replay synth handles
// the cassette field correctly; the gap is purely on the record path.

describe('record + replay: aborted (execa)', () => {
  const tmp = useTmpDir('sc-aborted-execa-')

  test('cancelSignal abort records aborted/failed, replays as throw', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    // Record: real execa cancellation. The live result exposes
    // `isCanceled` (execa's field name); the cassette stores it as
    // `aborted` (our internal schema). Both should be true.
    await useCassette(cp, async () => {
      const ac = new AbortController()
      setTimeout(() => ac.abort(), 100)
      const r = await execa('node', SLEEP_5S, { cancelSignal: ac.signal, reject: false })
      expect((r as { isCanceled: boolean }).isCanceled).toBe(true)
      expect((r as { failed: boolean }).failed).toBe(true)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings[0].result.aborted).toBe(true)
    expect(cassette.recordings[0].result.failed).toBe(true)

    // Replay: synth surfaces `isCanceled` from the cassette's `aborted`.
    // Default reject behavior throws.
    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const ac = new AbortController()
        await expect(execa('node', SLEEP_5S, { cancelSignal: ac.signal })).rejects.toThrow(
          /Command failed/,
        )
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  })
})
