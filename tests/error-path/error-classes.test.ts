import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  AckRequiredError,
  CassetteCollisionError,
  CassetteCorruptError,
  CassetteIOError,
  ConcurrencyError,
  ReplayMissError,
  ShellCassetteError,
  UnsupportedOptionError,
} from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { cassettePath } from '../../src/paths.js'
import { deriveCassettePathFromTask } from '../../src/plugin.js'
import { deserialize } from '../../src/serialize.js'
import { clearActiveCassette, setActiveCassette } from '../../src/state.js'
import { useCassette } from '../../src/use-cassette.js'

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
})

afterEach(() => {
  clearActiveCassette()
  if (originalAck === undefined) {
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
  } else {
    process.env.SHELL_CASSETTE_ACK_REDACTION = originalAck
  }
})

describe('all error classes are instanceof ShellCassetteError', () => {
  test('AckRequiredError', async () => {
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      setActiveCassette({
        name: 'x',
        path: path.join(tmp, 'a.json'),
        scopeDefault: 'auto',
        loadedFile: null,
        matcher: null,
        newRecordings: [],
      })
      try {
        await execa('node', ['-v'])
        throw new Error('should not reach')
      } catch (e) {
        expect(e).toBeInstanceOf(AckRequiredError)
        expect(e).toBeInstanceOf(ShellCassetteError)
        expect((e as Error).message).toContain('SHELL_CASSETTE_ACK_REDACTION')
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('UnsupportedOptionError', async () => {
    try {
      // @ts-expect-error: deliberate
      await execa('node', ['-v'], { ipc: true })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedOptionError)
    }
  })

  test('ReplayMissError', async () => {
    process.env.SHELL_CASSETTE_MODE = 'replay'
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      setActiveCassette({
        name: 'x',
        path: path.join(tmp, 'missing.json'),
        scopeDefault: 'auto',
        loadedFile: null,
        matcher: null,
        newRecordings: [],
      })
      try {
        await execa('node', ['-v'])
        throw new Error('should not reach')
      } catch (e) {
        expect(e).toBeInstanceOf(ReplayMissError)
      }
    } finally {
      delete process.env.SHELL_CASSETTE_MODE
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('ConcurrencyError', () => {
    expect(() =>
      deriveCassettePathFromTask(
        {
          name: 'x',
          file: { filepath: '/x.test.ts' },
          concurrent: true,
        } as never,
        '__cassettes__',
      ),
    ).toThrow(ConcurrencyError)
  })

  test('CassetteCorruptError', () => {
    expect(() => deserialize('{ bad json')).toThrow(CassetteCorruptError)
  })

  test('CassetteCollisionError', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const sharedPath = path.join(tmp, 'shared.json')
      const promiseA = useCassette(sharedPath, async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      try {
        await useCassette(sharedPath, async () => {
          /* should fail */
        })
        await promiseA
        throw new Error('should not reach')
      } catch (e) {
        await promiseA.catch(() => {
          /* swallow */
        })
        expect(e).toBeInstanceOf(CassetteCollisionError)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('CassetteIOError on long path', () => {
    const longPath = `/repo/${'a'.repeat(300)}/test.ts`
    expect(() => cassettePath(longPath, [], 'test', '__cassettes__')).toThrow(CassetteIOError)
  })
})
