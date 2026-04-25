import { describe, expect, test } from 'vitest'
import { resolveMode } from '../../src/mode.js'

describe('resolveMode', () => {
  test('returns scopeDefault when no env vars set', () => {
    expect(resolveMode(undefined, false, 'auto')).toBe('auto')
    expect(resolveMode(undefined, false, 'passthrough')).toBe('passthrough')
  })

  test('SHELL_CASSETTE_MODE env var wins over everything', () => {
    expect(resolveMode('record', true, 'auto')).toBe('record')
    expect(resolveMode('replay', false, 'auto')).toBe('replay')
    expect(resolveMode('passthrough', true, 'auto')).toBe('passthrough')
    expect(resolveMode('auto', true, 'passthrough')).toBe('auto')
  })

  test('CI=true forces replay-strict when no env override', () => {
    expect(resolveMode(undefined, true, 'auto')).toBe('replay')
    expect(resolveMode(undefined, true, 'passthrough')).toBe('replay')
  })

  test('invalid env var values fall through to next priority', () => {
    expect(resolveMode('invalid-mode', false, 'auto')).toBe('auto')
    expect(resolveMode('', false, 'auto')).toBe('auto')
    expect(resolveMode('invalid-mode', true, 'auto')).toBe('replay')
  })
})
