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

describe('e2e: timeout round-trip', () => {
  const tmp = useTmpDir('sc-e2e-timeout-')

  test('real subprocess timeout records and replays with matching shape', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    await useCassette(cp, async () => {
      const r = await execa('node', SLEEP_5S, { timeout: 200, reject: false })
      expect((r as { timedOut: boolean }).timedOut).toBe(true)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings[0].result.timedOut).toBe(true)
    expect(cassette.recordings[0].result.failed).toBe(true)

    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa('node', SLEEP_5S, { timeout: 200, reject: false })
        expect((r as { timedOut: boolean }).timedOut).toBe(true)
        expect((r as { failed: boolean }).failed).toBe(true)
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  }, 10_000)
})
