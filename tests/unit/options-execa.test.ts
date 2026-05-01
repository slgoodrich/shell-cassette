import { describe, expect, test } from 'vitest'
import { ShellCassetteError, UnsupportedOptionError } from '../../src/errors.js'
import { validateOptions } from '../../src/options-execa.js'

describe('validateOptions', () => {
  test('passes for empty options', () => {
    expect(() => validateOptions({})).not.toThrow()
    expect(() => validateOptions(undefined)).not.toThrow()
  })

  test('passes for supported options', () => {
    expect(() => validateOptions({ cwd: '/tmp', env: {} })).not.toThrow()
    expect(() => validateOptions({ reject: true })).not.toThrow()
    expect(() => validateOptions({ lines: true })).not.toThrow()
    expect(() => validateOptions({ timeout: 5000 })).not.toThrow()
  })

  test('throws on buffer:false', () => {
    expect(() => validateOptions({ buffer: false })).toThrow(UnsupportedOptionError)
    expect(() => validateOptions({ buffer: false })).toThrow(ShellCassetteError)
    expect(() => validateOptions({ buffer: false })).toThrow(/buffer/)
  })

  test('throws on ipc:true', () => {
    expect(() => validateOptions({ ipc: true })).toThrow(UnsupportedOptionError)
    expect(() => validateOptions({ ipc: true })).toThrow(ShellCassetteError)
  })

  test('accepts inputFile as a string path', () => {
    expect(() => validateOptions({ inputFile: '/tmp/x' })).not.toThrow()
  })

  test('accepts input as a string', () => {
    expect(() => validateOptions({ input: 'data' })).not.toThrow()
    expect(() => validateOptions({ input: '' })).not.toThrow()
  })

  test('rejects input as Uint8Array', () => {
    expect(() => validateOptions({ input: new Uint8Array([1, 2, 3]) })).toThrow(
      UnsupportedOptionError,
    )
    expect(() => validateOptions({ input: new Uint8Array([1, 2, 3]) })).toThrow(ShellCassetteError)
    expect(() => validateOptions({ input: new Uint8Array([1, 2, 3]) })).toThrow(/input/)
  })

  test('rejects input as a Readable-like object', () => {
    // The validator branches on `typeof input !== 'string'` so any non-string
    // (object, number, boolean, ...) hits the same path. A bare object stands in
    // for a Readable here without pulling node:stream into the test.
    expect(() => validateOptions({ input: { read: () => null } })).toThrow(UnsupportedOptionError)
    expect(() => validateOptions({ input: { read: () => null } })).toThrow(ShellCassetteError)
  })

  test('accepts node:true (execaNode is supported)', () => {
    expect(() => validateOptions({ node: true })).not.toThrow()
  })

  test('error message includes the option name', () => {
    try {
      validateOptions({ ipc: true })
    } catch (e) {
      expect((e as Error).message).toContain('ipc')
    }
  })

  test('rejection message for non-string input does not embed a version number', () => {
    try {
      validateOptions({ input: new Uint8Array([1, 2, 3]) })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedOptionError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).not.toMatch(/v0\.\d/)
    }
  })

  describe('input + inputFile conflict matrix', () => {
    test('inputFile alone is accepted (input undefined)', () => {
      expect(() => validateOptions({ inputFile: '/tmp/x' })).not.toThrow()
    })

    test("input: 'foo' with inputFile rejects with UnsupportedOptionError", () => {
      expect(() => validateOptions({ input: 'foo', inputFile: '/tmp/x' })).toThrow(
        UnsupportedOptionError,
      )
      expect(() => validateOptions({ input: 'foo', inputFile: '/tmp/x' })).toThrow(
        ShellCassetteError,
      )
      expect(() => validateOptions({ input: 'foo', inputFile: '/tmp/x' })).toThrow(/inputFile/)
    })

    test("input: '' with inputFile rejects (empty string is still set)", () => {
      expect(() => validateOptions({ input: '', inputFile: '/tmp/x' })).toThrow(
        UnsupportedOptionError,
      )
      expect(() => validateOptions({ input: '', inputFile: '/tmp/x' })).toThrow(ShellCassetteError)
    })

    test('input: null with inputFile rejects (null is still defined)', () => {
      expect(() => validateOptions({ input: null, inputFile: '/tmp/x' })).toThrow(
        UnsupportedOptionError,
      )
      expect(() => validateOptions({ input: null, inputFile: '/tmp/x' })).toThrow(
        ShellCassetteError,
      )
    })
  })
})
