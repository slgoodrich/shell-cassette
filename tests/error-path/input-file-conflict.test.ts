import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ShellCassetteError, UnsupportedOptionError } from '../../src/errors.js'
import { execa } from '../../src/execa.js'
import { restoreEnv } from '../helpers/env.js'

// The validator's conflict check fires before any cassette/state lookup, so
// these tests do not need an active cassette session. Pin the mode so CI=true
// on the runner does not force replay-strict and surface NoActiveSessionError
// before the validator runs (it would not anyway, since validate() is the
// first call inside runWrapped, but pinning keeps the test focused).

const originalMode = process.env.SHELL_CASSETTE_MODE

beforeEach(() => {
  process.env.SHELL_CASSETTE_MODE = 'passthrough'
})

afterEach(() => {
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

describe('input + inputFile conflict (validator)', () => {
  test("input: 'foo' + inputFile rejects with UnsupportedOptionError", async () => {
    try {
      await execa('node', ['-v'], { input: 'foo', inputFile: '/tmp/x' })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedOptionError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain('inputFile')
    }
  })

  test("input: '' + inputFile rejects (empty string is still a set value)", async () => {
    try {
      await execa('node', ['-v'], { input: '', inputFile: '/tmp/x' })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedOptionError)
      expect(e).toBeInstanceOf(ShellCassetteError)
    }
  })

  test('input: null + inputFile rejects (null is still defined)', async () => {
    try {
      // execa's types reject `input: null`; bypass with a cast for the conflict test.
      await execa('node', ['-v'], { input: null, inputFile: '/tmp/x' } as never)
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedOptionError)
      expect(e).toBeInstanceOf(ShellCassetteError)
    }
  })

  test('inputFile alone (input undefined) is accepted by the validator', async () => {
    // The validator does not raise UnsupportedOptionError. The call may still
    // fail downstream (real execa errors when the file does not exist) but
    // that is a different class. Tested against a real path so passthrough
    // does not blow up the test.
    try {
      await execa('node', ['-v'], { inputFile: '/nonexistent-path-for-validator-test' })
    } catch (e) {
      expect(e).not.toBeInstanceOf(UnsupportedOptionError)
    }
  })
})
