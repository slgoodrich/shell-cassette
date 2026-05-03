import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { SLEEP_5S } from '../helpers/subprocess-targets.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

describe('e2e: cancelSignal round-trip', () => {
  const tmp = useTmpDir('sc-e2e-cancel-')

  test('real subprocess aborted via cancelSignal records aborted, replays as throw', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    await useCassette(cp, async () => {
      const ac = new AbortController()
      setTimeout(() => ac.abort(), 100)
      const r = await execa('node', SLEEP_5S, { cancelSignal: ac.signal, reject: false })
      // Real execa exposes isCanceled (the cassette stores it as aborted).
      expect((r as { isCanceled: boolean }).isCanceled).toBe(true)
      expect((r as { failed: boolean }).failed).toBe(true)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings[0].result.aborted).toBe(true)
    expect(cassette.recordings[0].result.failed).toBe(true)

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
  }, 10_000)
})
