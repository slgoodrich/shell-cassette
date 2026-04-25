import { describe, expect, test } from 'vitest'
import { cleanStack } from '../../src/stack.js'

describe('cleanStack', () => {
  test('removes lines containing /shell-cassette/', () => {
    const input = `Error: boom
    at userFn (/Users/me/app/test.ts:5:10)
    at Object.<anonymous> (/Users/me/app/node_modules/shell-cassette/dist/execa.js:42:8)
    at runTest (/Users/me/app/test.ts:10:3)`

    const output = cleanStack(input)
    expect(output).toContain('userFn')
    expect(output).toContain('runTest')
    expect(output).not.toContain('shell-cassette')
  })

  test('returns input unchanged if no shell-cassette frames', () => {
    const input = `Error: boom\n    at fn (/path/to/file.ts:5:10)`
    expect(cleanStack(input)).toBe(input)
  })

  test('returns empty string for empty input', () => {
    expect(cleanStack('')).toBe('')
  })

  test('handles undefined gracefully', () => {
    expect(cleanStack(undefined)).toBe('')
  })
})
