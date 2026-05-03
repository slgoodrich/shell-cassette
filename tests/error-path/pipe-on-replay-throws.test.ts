import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { UnsupportedOptionError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

describe('error path: subprocess-API stubs on replay (execa)', () => {
  const tmp = useTmpDir('sc-execa-stubs-')

  test('result.pipe() throws UnsupportedOptionError', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')

    await useCassette(cp, async () => {
      await execa('node', ['-v'])
    })

    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = (await execa('node', ['-v'])) as unknown as {
          pipe: () => unknown
        }
        expect(typeof r.pipe).toBe('function')
        expect(() => r.pipe()).toThrow(UnsupportedOptionError)
        expect(() => r.pipe()).toThrow(/passthrough/i)
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  })

  test('result[Symbol.asyncIterator]() throws UnsupportedOptionError', async () => {
    const cp = path.join(tmp.ref(), 'cassette-iter.json')

    await useCassette(cp, async () => {
      await execa('node', ['-v'])
    })

    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = (await execa('node', ['-v'])) as unknown as {
          [Symbol.asyncIterator]: () => unknown
        }
        expect(() => r[Symbol.asyncIterator]()).toThrow(UnsupportedOptionError)
        expect(() => r[Symbol.asyncIterator]()).toThrow(/result\.stdout/i)
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  })

  test('result.kill() returns false (no-op)', async () => {
    const cp = path.join(tmp.ref(), 'cassette-kill.json')

    await useCassette(cp, async () => {
      await execa('node', ['-v'])
    })

    const prevMode = process.env.SHELL_CASSETTE_MODE
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = (await execa('node', ['-v'])) as unknown as { kill: () => boolean }
        expect(r.kill()).toBe(false)
      })
    } finally {
      restoreEnv('SHELL_CASSETTE_MODE', prevMode)
    }
  })
})
