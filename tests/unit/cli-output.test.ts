import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { applyTruncation, color, formatBytes, isTty } from '../../src/cli-output.js'
import { restoreEnv } from '../helpers/env.js'

describe('color helpers', () => {
  beforeEach(() => {
    color.setEnabled(true)
  })

  test('cyan wraps text in ANSI color codes when enabled', () => {
    const out = color.cyan('hello')
    expect(out).toBe('\x1b[36mhello\x1b[0m')
  })

  test('all helpers return raw text when disabled', () => {
    color.setEnabled(false)
    expect(color.cyan('hello')).toBe('hello')
    expect(color.red('hello')).toBe('hello')
    expect(color.green('hello')).toBe('hello')
    expect(color.bold('hello')).toBe('hello')
    expect(color.dim('hello')).toBe('hello')
    expect(color.yellow('hello')).toBe('hello')
  })

  test('isEnabled reflects setEnabled state', () => {
    color.setEnabled(true)
    expect(color.isEnabled()).toBe(true)
    color.setEnabled(false)
    expect(color.isEnabled()).toBe(false)
  })
})

describe('isTty.shouldUseColor', () => {
  const originalNoColor = process.env.NO_COLOR

  beforeEach(() => {
    delete process.env.NO_COLOR
  })

  afterEach(() => {
    restoreEnv('NO_COLOR', originalNoColor)
  })

  test('NO_COLOR env disables colors even on TTY', () => {
    process.env.NO_COLOR = '1'
    expect(isTty.shouldUseColor({ tty: true, override: undefined })).toBe(false)
  })

  test('NO_COLOR env disables colors regardless of override (when override is auto)', () => {
    process.env.NO_COLOR = '1'
    expect(isTty.shouldUseColor({ tty: true, override: 'auto' })).toBe(false)
  })

  test('--no-color override disables colors even on TTY', () => {
    expect(isTty.shouldUseColor({ tty: true, override: 'never' })).toBe(false)
  })

  test('--color=always overrides NO_COLOR', () => {
    process.env.NO_COLOR = '1'
    expect(isTty.shouldUseColor({ tty: false, override: 'always' })).toBe(true)
  })

  test('TTY auto + no overrides + no NO_COLOR: enabled', () => {
    expect(isTty.shouldUseColor({ tty: true, override: undefined })).toBe(true)
  })

  test('non-TTY auto + no overrides: disabled', () => {
    expect(isTty.shouldUseColor({ tty: false, override: undefined })).toBe(false)
  })

  test('empty NO_COLOR string is treated as unset (no-color spec)', () => {
    process.env.NO_COLOR = ''
    expect(isTty.shouldUseColor({ tty: true, override: undefined })).toBe(true)
  })
})

describe('applyTruncation', () => {
  test('returns input unchanged when shorter than limit', () => {
    expect(applyTruncation('hello', 10)).toBe('hello')
  })

  test('returns input unchanged when equal to limit', () => {
    expect(applyTruncation('hello', 5)).toBe('hello')
  })

  test('truncates with ellipsis when longer than limit', () => {
    expect(applyTruncation('a'.repeat(100), 10)).toBe('aaaaaaaaaa…')
  })

  test('limit of 0 returns just ellipsis', () => {
    expect(applyTruncation('hello', 0)).toBe('…')
  })

  test('empty string returns empty string', () => {
    expect(applyTruncation('', 10)).toBe('')
  })
})

describe('formatBytes', () => {
  test('zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  test('bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  test('exactly 1 KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
  })

  test('partial KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  test('exactly 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })

  test('partial MB', () => {
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB')
  })

  test('exactly 1 GB', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
  })
})
