import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

// Long-running script: sleeps 5s. The wrapper's timeout=200ms fires first.
const SLEEP_5S = ['-e', 'setTimeout(() => {}, 5000)']

describe('record + replay: timeout (execa)', () => {
  const tmp = useTmpDir('sc-timeout-')

  test('records timedOut + failed, replays with matching shape, throws on default reject', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    // Record: real subprocess hits timeout, throws ExecaError-shaped
    let recordedTimedOut: boolean | undefined
    let recordedFailed: boolean | undefined
    await useCassette(cp, async () => {
      await execa('node', SLEEP_5S, { timeout: 200, reject: false })
      const r = await execa('node', SLEEP_5S, { timeout: 200, reject: false })
      recordedTimedOut = (r as { timedOut: boolean }).timedOut
      recordedFailed = (r as { failed: boolean }).failed
    })

    expect(recordedTimedOut).toBe(true)
    expect(recordedFailed).toBe(true)

    // Cassette stores the new fields
    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    const recResult = cassette.recordings[0].result
    expect(recResult.timedOut).toBe(true)
    expect(recResult.failed).toBe(true)

    // Replay: same shape, throws on default reject
    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa('node', SLEEP_5S, { timeout: 200, reject: false })
        expect((r as { timedOut: boolean }).timedOut).toBe(true)
        expect((r as { failed: boolean }).failed).toBe(true)

        await expect(execa('node', SLEEP_5S, { timeout: 200 })).rejects.toThrow(/Command failed/)
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  })
})
