import { describe, expect, test } from 'vitest'
import { UnsupportedOptionError } from '../../src/errors.js'
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
    expect(() => validateOptions({ buffer: false })).toThrow(/buffer/)
  })

  test('throws on ipc:true', () => {
    expect(() => validateOptions({ ipc: true })).toThrow(UnsupportedOptionError)
  })

  test('throws on inputFile', () => {
    expect(() => validateOptions({ inputFile: '/tmp/x' })).toThrow(UnsupportedOptionError)
  })

  test('throws on input (stdin)', () => {
    expect(() => validateOptions({ input: 'data' })).toThrow(UnsupportedOptionError)
  })

  test('throws on node:true (execaNode)', () => {
    expect(() => validateOptions({ node: true })).toThrow(UnsupportedOptionError)
  })

  test('error message includes the option name and target version', () => {
    try {
      validateOptions({ ipc: true })
    } catch (e) {
      expect((e as Error).message).toContain('ipc')
      expect((e as Error).message).toContain('Tracked in backlog')
    }
  })
})
