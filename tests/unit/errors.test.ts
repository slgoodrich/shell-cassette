import { describe, expect, test } from 'vitest'
import {
  ShellCassetteError,
  AckRequiredError,
  UnsupportedOptionError,
  ReplayMissError,
  ConcurrencyError,
  BinaryOutputError,
  CassetteCorruptError,
  CassetteCollisionError,
  CassetteIOError,
  CassetteConfigError,
} from '../../src/errors.js'

describe('error classes', () => {
  test('all errors inherit from ShellCassetteError', () => {
    expect(new AckRequiredError('msg')).toBeInstanceOf(ShellCassetteError)
    expect(new UnsupportedOptionError('msg')).toBeInstanceOf(ShellCassetteError)
    expect(new ReplayMissError('msg')).toBeInstanceOf(ShellCassetteError)
    expect(new ConcurrencyError('msg')).toBeInstanceOf(ShellCassetteError)
    expect(new BinaryOutputError('msg')).toBeInstanceOf(ShellCassetteError)
    expect(new CassetteCorruptError('msg')).toBeInstanceOf(ShellCassetteError)
    expect(new CassetteCollisionError('msg')).toBeInstanceOf(ShellCassetteError)
    expect(new CassetteIOError('msg', new Error('cause'))).toBeInstanceOf(ShellCassetteError)
    expect(new CassetteConfigError('msg')).toBeInstanceOf(ShellCassetteError)
  })

  test('all errors have stable code strings', () => {
    expect(AckRequiredError.code).toBe('CASSETTE_ACK_REQUIRED')
    expect(UnsupportedOptionError.code).toBe('CASSETTE_UNSUPPORTED_OPTION')
    expect(ReplayMissError.code).toBe('CASSETTE_REPLAY_MISS')
    expect(ConcurrencyError.code).toBe('CASSETTE_CONCURRENT')
    expect(BinaryOutputError.code).toBe('CASSETTE_BINARY_OUTPUT')
    expect(CassetteCorruptError.code).toBe('CASSETTE_CORRUPT')
    expect(CassetteCollisionError.code).toBe('CASSETTE_COLLISION')
    expect(CassetteIOError.code).toBe('CASSETTE_IO')
    expect(CassetteConfigError.code).toBe('CASSETTE_CONFIG')
  })

  test('CassetteIOError preserves cause', () => {
    const cause = new Error('disk full')
    const err = new CassetteIOError('failed to write', cause)
    expect(err.cause).toBe(cause)
  })

  test('all errors have name matching class name', () => {
    expect(new AckRequiredError('').name).toBe('AckRequiredError')
    expect(new ReplayMissError('').name).toBe('ReplayMissError')
  })
})
