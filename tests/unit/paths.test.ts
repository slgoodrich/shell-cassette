import { describe, expect, test } from 'vitest'
import { CassetteIOError } from '../../src/errors.js'
import { cassettePath, sanitizeName } from '../../src/paths.js'

describe('sanitizeName', () => {
  test('preserves simple names', () => {
    expect(sanitizeName('finds-current-branch')).toBe('finds-current-branch')
  })

  test('lowercases and kebab-cases spaces', () => {
    expect(sanitizeName('Finds Current Branch')).toBe('finds-current-branch')
  })

  test('strips non-ASCII via NFKD normalize', () => {
    // "café" → "cafe" via NFKD
    expect(sanitizeName('Visits café')).toBe('visits-cafe')
  })

  test('replaces special characters with dashes', () => {
    expect(sanitizeName('handles "quoted" strings & special!')).toBe(
      'handles-quoted-strings-special',
    )
  })

  test('collapses consecutive dashes', () => {
    expect(sanitizeName('--foo--bar--')).toBe('foo-bar')
  })

  test('truncates to 80 chars with hash suffix', () => {
    const long = 'a'.repeat(100)
    const result = sanitizeName(long)
    expect(result.length).toBeLessThanOrEqual(80 + 7) // 80 + '-' + 6-char hash
    expect(result).toMatch(/^a+-[a-f0-9]{6}$/)
  })

  test('different long inputs yield different hash suffixes', () => {
    const a = sanitizeName('a'.repeat(100))
    const b = sanitizeName('b'.repeat(100))
    expect(a).not.toBe(b)
  })

  test('handles empty string with placeholder', () => {
    expect(sanitizeName('')).toBe('untitled')
  })
})

describe('cassettePath', () => {
  test('builds path next to test file in __cassettes__/', () => {
    const result = cassettePath('/repo/src/foo.test.ts', [], 'my test', '__cassettes__')
    expect(result).toBe('/repo/src/__cassettes__/foo.test.ts/my-test.json')
  })

  test('includes describe path as nested directories', () => {
    const result = cassettePath(
      '/repo/src/foo.test.ts',
      ['outer', 'inner'],
      'leaf',
      '__cassettes__',
    )
    expect(result).toBe('/repo/src/__cassettes__/foo.test.ts/outer/inner/leaf.json')
  })

  test('sanitizes describe and test name segments', () => {
    const result = cassettePath(
      '/repo/src/foo.test.ts',
      ['Has Spaces'],
      'My Test!',
      '__cassettes__',
    )
    expect(result).toBe('/repo/src/__cassettes__/foo.test.ts/has-spaces/my-test.json')
  })

  test('throws CassetteIOError if total path > 240 chars (Windows safe)', () => {
    const longTestPath = `/repo/${'a'.repeat(300)}/foo.test.ts`
    expect(() => cassettePath(longTestPath, [], 'test', '__cassettes__')).toThrow(CassetteIOError)
  })
})
