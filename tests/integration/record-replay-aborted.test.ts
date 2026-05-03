import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { x } from '../../src/tinyexec.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { SLEEP_5S } from '../helpers/subprocess-targets.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

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

// Closes #126: tinyexec's awaited Output drops the OutputApi getters
// (aborted, killed) that live on the pre-await ExecProcess. The adapter's
// realCall snapshots them before await so captureResult sees real values.
describe('record + replay: aborted (tinyexec)', () => {
  const tmp = useTmpDir('sc-aborted-tinyexec-')

  test('signal abort records aborted=true; replay surfaces aborted=true', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    await useCassette(cp, async () => {
      const ac = new AbortController()
      setTimeout(() => ac.abort(), 100)
      const r = await x('node', [...SLEEP_5S], { signal: ac.signal })
      expect(r.aborted).toBe(true)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings[0].result.aborted).toBe(true)
    expect(cassette.recordings[0].result.failed).toBe(true)

    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const ac = new AbortController()
        const r = await x('node', [...SLEEP_5S], { signal: ac.signal })
        expect(r.aborted).toBe(true)
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  })
})
