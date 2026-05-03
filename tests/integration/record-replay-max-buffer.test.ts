import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

// Print 10 KiB to stdout. With maxBuffer=1024 the call exceeds the limit.
const PRINT_10K = ['-e', "process.stdout.write('x'.repeat(10000))"]

describe('record + replay: maxBuffer (execa)', () => {
  const tmp = useTmpDir('sc-maxbuf-')

  test('isMaxBuffer + failed captured, replays with matching shape', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    await useCassette(cp, async () => {
      // First call: record the failing result (consumed by replay's reject:false call).
      const r = await execa('node', PRINT_10K, { maxBuffer: 1024, reject: false })
      expect((r as { isMaxBuffer: boolean }).isMaxBuffer).toBe(true)
      expect((r as { failed: boolean }).failed).toBe(true)
      // Second call: record again for the replay's default-reject throw assertion.
      await execa('node', PRINT_10K, { maxBuffer: 1024, reject: false })
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings[0].result.isMaxBuffer).toBe(true)
    expect(cassette.recordings[0].result.failed).toBe(true)

    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa('node', PRINT_10K, { maxBuffer: 1024, reject: false })
        expect((r as { isMaxBuffer: boolean }).isMaxBuffer).toBe(true)

        await expect(execa('node', PRINT_10K, { maxBuffer: 1024 })).rejects.toThrow(
          /Command failed/,
        )
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  })
})
