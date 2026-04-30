import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ReplayMissError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { x } from '../../src/tinyexec.js'
import { useCassette } from '../../src/use-cassette.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { NODE_ECHO_STDIN } from '../helpers/subprocess-targets.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

describe('e2e record + replay with input: string', () => {
  const tmp = useTmpDir('sc-stdin-')

  test('input: "foo" round-trips and matches on replay', async () => {
    const cp = path.join(tmp.ref(), 'stdin.json')

    let firstStdout: string | undefined
    await useCassette(cp, async () => {
      const r = await execa('node', NODE_ECHO_STDIN, { input: 'foo' })
      firstStdout = r.stdout
      expect(firstStdout).toBe('foo')
    })

    await useCassette(cp, async () => {
      const r = await execa('node', NODE_ECHO_STDIN, { input: 'foo' })
      expect(r.stdout).toBe(firstStdout)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings).toHaveLength(1)
    expect(cassette.recordings[0].call.stdin).toBe('foo')
  })

  test('different stdin values do NOT match the same recording', async () => {
    const cp = path.join(tmp.ref(), 'stdin-mismatch.json')

    // Record with input: 'foo'
    await useCassette(cp, async () => {
      const r = await execa('node', NODE_ECHO_STDIN, { input: 'foo' })
      expect(r.stdout).toBe('foo')
    })

    // Replay-strict against the same command but input: 'bar' should miss,
    // confirming the matcher includes stdin in canonical form.
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        try {
          await execa('node', NODE_ECHO_STDIN, { input: 'bar' })
          throw new Error('should not reach')
        } catch (e) {
          expect(e).toBeInstanceOf(ReplayMissError)
        }
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })
})

describe('tinyexec stdin', () => {
  const tmp = useTmpDir('sc-tinyexec-stdin-')

  test('stdin: "foo" round-trips and matches on replay', async () => {
    const cp = path.join(tmp.ref(), 'stdin.json')

    let firstStdout: string | undefined
    await useCassette(cp, async () => {
      const r = await x('node', NODE_ECHO_STDIN, { stdin: 'foo' })
      firstStdout = r.stdout
      expect(firstStdout).toBe('foo')
    })

    await useCassette(cp, async () => {
      const r = await x('node', NODE_ECHO_STDIN, { stdin: 'foo' })
      expect(r.stdout).toBe(firstStdout)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings).toHaveLength(1)
    expect(cassette.recordings[0].call.stdin).toBe('foo')
  })

  test('different stdin values do NOT match the same recording', async () => {
    const cp = path.join(tmp.ref(), 'stdin-mismatch.json')

    await useCassette(cp, async () => {
      const r = await x('node', NODE_ECHO_STDIN, { stdin: 'foo' })
      expect(r.stdout).toBe('foo')
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        try {
          await x('node', NODE_ECHO_STDIN, { stdin: 'bar' })
          throw new Error('should not reach')
        } catch (e) {
          expect(e).toBeInstanceOf(ReplayMissError)
        }
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })
})
