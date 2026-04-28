import { describe, expect, test } from 'vitest'
import { parseTopLevel } from '../../src/cli.js'

describe('parseTopLevel', () => {
  test('--help', () => {
    expect(parseTopLevel(['--help'])).toEqual({ help: true, rest: [] })
  })

  test('-h', () => {
    expect(parseTopLevel(['-h'])).toEqual({ help: true, rest: [] })
  })

  test('--version', () => {
    expect(parseTopLevel(['--version'])).toEqual({ version: true, rest: [] })
  })

  test('-V', () => {
    expect(parseTopLevel(['-V'])).toEqual({ version: true, rest: [] })
  })

  test('command only', () => {
    expect(parseTopLevel(['scan'])).toEqual({ command: 'scan', rest: [] })
  })

  test('command with positional args', () => {
    expect(parseTopLevel(['scan', 'foo.json', 'bar.json'])).toEqual({
      command: 'scan',
      rest: ['foo.json', 'bar.json'],
    })
  })

  test('command with flag args', () => {
    expect(parseTopLevel(['scan', 'foo.json', '--json'])).toEqual({
      command: 'scan',
      rest: ['foo.json', '--json'],
    })
  })

  test('command with help-after passes through to subcommand', () => {
    expect(parseTopLevel(['scan', '--help'])).toEqual({
      command: 'scan',
      rest: ['--help'],
    })
  })

  test('--help BEFORE command takes priority', () => {
    expect(parseTopLevel(['--help', 'scan'])).toEqual({
      help: true,
      rest: [],
    })
  })

  test('--version BEFORE command takes priority', () => {
    expect(parseTopLevel(['--version', 'scan'])).toEqual({
      version: true,
      rest: [],
    })
  })

  test('empty argv', () => {
    expect(parseTopLevel([])).toEqual({ rest: [] })
  })
})
