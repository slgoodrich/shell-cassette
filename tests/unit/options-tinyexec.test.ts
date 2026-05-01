import { describe, expect, test } from 'vitest'
import { ShellCassetteError, UnsupportedOptionError } from '../../src/errors.js'
import { validateOptions } from '../../src/options-tinyexec.js'

describe('validateOptions (tinyexec)', () => {
  test('accepts undefined options', () => {
    expect(() => validateOptions(undefined)).not.toThrow()
  })

  test('accepts empty options', () => {
    expect(() => validateOptions({})).not.toThrow()
  })

  test('throws UnsupportedOptionError for persist:true', () => {
    expect(() => validateOptions({ persist: true })).toThrow(UnsupportedOptionError)
    expect(() => validateOptions({ persist: true })).toThrow(ShellCassetteError)
  })

  test('error message for persist:true mentions persist', () => {
    try {
      validateOptions({ persist: true })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedOptionError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain('persist')
    }
  })

  test('accepts persist:false', () => {
    expect(() => validateOptions({ persist: false })).not.toThrow()
  })

  test('throws UnsupportedOptionError for stdin as object (Result piping)', () => {
    const fakeResult = { stdout: 'foo', stderr: '', exitCode: 0 }
    expect(() => validateOptions({ stdin: fakeResult })).toThrow(UnsupportedOptionError)
    expect(() => validateOptions({ stdin: fakeResult })).toThrow(ShellCassetteError)
  })

  test('error message for stdin-as-object mentions stdin and string', () => {
    try {
      validateOptions({ stdin: { stdout: 'x' } })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedOptionError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain('stdin')
      expect((e as Error).message).toContain('string')
    }
  })

  test('accepts stdin as string', () => {
    expect(() => validateOptions({ stdin: 'hello' })).not.toThrow()
  })

  test('accepts stdin as undefined', () => {
    expect(() => validateOptions({ stdin: undefined })).not.toThrow()
  })

  test('accepts stdin as null', () => {
    expect(() => validateOptions({ stdin: null })).not.toThrow()
  })

  test('accepts signal, timeout, nodeOptions, throwOnError together', () => {
    const aborter = new AbortController()
    expect(() =>
      validateOptions({
        signal: aborter.signal,
        timeout: 5000,
        nodeOptions: { cwd: '/tmp' },
        throwOnError: true,
      }),
    ).not.toThrow()
  })

  test('accepts unknown future options without throwing', () => {
    // Forward-compat: tinyexec may add options we don't know about; we accept them.
    expect(() => validateOptions({ someUnknownFutureOption: true })).not.toThrow()
  })
})
