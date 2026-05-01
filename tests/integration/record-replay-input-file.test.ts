import { readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { CassetteIOError, ReplayMissError, ShellCassetteError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { NODE_ECHO_STDIN } from '../helpers/subprocess-targets.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

describe('e2e record + replay with inputFile', () => {
  const tmp = useTmpDir('sc-input-file-')

  test('inputFile content round-trips and matches on replay', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')
    const fixture = path.join(tmp.ref(), 'in.txt')
    await writeFile(fixture, 'hello-from-file', 'utf8')

    let firstStdout: string | undefined
    await useCassette(cp, async () => {
      const r = await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
      firstStdout = r.stdout
      expect(firstStdout).toBe('hello-from-file')
    })

    await useCassette(cp, async () => {
      const r = await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
      expect(r.stdout).toBe(firstStdout)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings[0].call.stdin).toBe('hello-from-file')
  })

  test('mutating the fixture causes replay to miss (file content is part of canonical form)', async () => {
    const cp = path.join(tmp.ref(), 'mutated.json')
    const fixture = path.join(tmp.ref(), 'mut.txt')
    await writeFile(fixture, 'original', 'utf8')

    await useCassette(cp, async () => {
      const r = await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
      expect(r.stdout).toBe('original')
    })

    await writeFile(fixture, 'changed', 'utf8')

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        try {
          await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
          throw new Error('should not reach')
        } catch (e) {
          expect(e).toBeInstanceOf(ReplayMissError)
          expect(e).toBeInstanceOf(ShellCassetteError)
        }
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })

  test('deleting the fixture causes replay to throw CassetteIOError (strict-read)', async () => {
    const cp = path.join(tmp.ref(), 'gone.json')
    const fixture = path.join(tmp.ref(), 'gone.txt')
    await writeFile(fixture, 'pre-delete', 'utf8')

    await useCassette(cp, async () => {
      const r = await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
      expect(r.stdout).toBe('pre-delete')
    })

    await unlink(fixture)

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        try {
          await execa('node', NODE_ECHO_STDIN, { inputFile: fixture })
          throw new Error('should not reach')
        } catch (e) {
          expect(e).toBeInstanceOf(CassetteIOError)
          expect(e).toBeInstanceOf(ShellCassetteError)
          expect((e as Error).message).toContain(fixture)
        }
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })
})
