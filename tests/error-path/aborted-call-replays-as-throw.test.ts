import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv({ mode: 'replay' })

describe('error path: legacy cassette aborted call replays as throw', () => {
  const tmp = useTmpDir('sc-legacy-aborted-')

  test('legacy cassette with aborted: true (no failed field) throws on default reject', async () => {
    const cp = path.join(tmp.ref(), 'legacy.json')

    // Hand-crafted legacy cassette: no failed/timedOut/* flags.
    // exitCode 0, no signal, aborted: true. Pre-fix code would replay as
    // success (exitCode 0); fallback derivation throws.
    const legacy = {
      version: 2,
      _recorded_by: { name: 'shell-cassette', version: '0.6.0' },
      recordings: [
        {
          call: { command: 'node', args: ['-v'], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: ['', ''],
            stderrLines: [''],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 50,
            aborted: true,
          },
          _redactions: [],
        },
      ],
    }
    await writeFile(cp, JSON.stringify(legacy, null, 2), 'utf8')

    await useCassette(cp, async () => {
      let caught: unknown
      try {
        await execa('node', ['-v'])
        throw new Error('should not reach')
      } catch (e) {
        caught = e
      }
      const err = caught as { name: string; failed: boolean; isCanceled: boolean }
      expect(err.name).toBe('ExecaError')
      expect(err.failed).toBe(true)
      expect(err.isCanceled).toBe(true)
    })
  })

  test('legacy cassette with signal kill (no failed field) throws on default reject', async () => {
    const cp = path.join(tmp.ref(), 'legacy-killed.json')

    const legacy = {
      version: 2,
      _recorded_by: { name: 'shell-cassette', version: '0.6.0' },
      recordings: [
        {
          call: { command: 'node', args: ['-v'], cwd: null, env: {}, stdin: null },
          result: {
            stdoutLines: ['', ''],
            stderrLines: [''],
            allLines: null,
            exitCode: 0,
            signal: 'SIGTERM',
            durationMs: 50,
            aborted: false,
          },
          _redactions: [],
        },
      ],
    }
    await writeFile(cp, JSON.stringify(legacy, null, 2), 'utf8')

    await useCassette(cp, async () => {
      await expect(execa('node', ['-v'])).rejects.toThrow(/Command failed/)
    })
  })
})
