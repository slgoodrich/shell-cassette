import { describe, expect, test } from 'vitest'
import { normalizeTmpPath } from '../../src/normalize.js'

describe('normalizeTmpPath - Linux /tmp', () => {
  test('replaces /tmp/<dir> with <tmp>', () => {
    expect(normalizeTmpPath('/tmp/test-abc/foo.git')).toBe('<tmp>/foo.git')
  })

  test('replaces multiple occurrences', () => {
    expect(normalizeTmpPath('/tmp/a/x.txt /tmp/b/y.txt')).toBe('<tmp>/x.txt <tmp>/y.txt')
  })

  test('preserves path beyond first component', () => {
    expect(normalizeTmpPath('/tmp/abc/sub/file.json')).toBe('<tmp>/sub/file.json')
  })
})

describe('normalizeTmpPath - Linux /var/tmp', () => {
  test('replaces /var/tmp/<dir> with <tmp>', () => {
    expect(normalizeTmpPath('/var/tmp/x/y')).toBe('<tmp>/y')
  })
})

describe('normalizeTmpPath - macOS /var/folders', () => {
  test('replaces /var/folders/<a>/<b>/T/<dir> with <tmp>', () => {
    expect(normalizeTmpPath('/var/folders/qw/abc123/T/release-test-AbCdEf/remote.git')).toBe(
      '<tmp>/remote.git',
    )
  })
})

describe('normalizeTmpPath - macOS /private/tmp', () => {
  test('replaces /private/tmp/<dir> with <tmp>', () => {
    expect(normalizeTmpPath('/private/tmp/test/x.txt')).toBe('<tmp>/x.txt')
  })
})

describe('normalizeTmpPath - Windows', () => {
  test('replaces C:\\Users\\<u>\\AppData\\Local\\Temp\\<dir> with <tmp>', () => {
    expect(
      normalizeTmpPath('C:\\Users\\steve\\AppData\\Local\\Temp\\foo-AbC\\bar\\baz.txt'),
    ).toBe('<tmp>\\bar\\baz.txt')
  })
})

describe('normalizeTmpPath - embedded substring', () => {
  test('replaces tmp prefix appearing inside an arg', () => {
    expect(normalizeTmpPath('--config=/tmp/abc/x.json')).toBe('--config=<tmp>/x.json')
  })
})

describe('normalizeTmpPath - disambiguation', () => {
  test('two files in same tmp dir produce different canonical forms', () => {
    expect(normalizeTmpPath('/tmp/abc/file-a.txt')).not.toBe(
      normalizeTmpPath('/tmp/abc/file-b.txt'),
    )
  })
})

describe('normalizeTmpPath - boundaries', () => {
  test('does not normalize /tmpfile (no slash after /tmp)', () => {
    expect(normalizeTmpPath('/tmpfile')).toBe('/tmpfile')
  })

  test('does not normalize /tmp/ (trailing slash, no component)', () => {
    expect(normalizeTmpPath('/tmp/')).toBe('/tmp/')
  })

  test('non-tmp string is unchanged', () => {
    expect(normalizeTmpPath('/usr/local/bin/foo')).toBe('/usr/local/bin/foo')
  })

  test('empty string is unchanged', () => {
    expect(normalizeTmpPath('')).toBe('')
  })
})

describe('normalizeTmpPath - idempotence', () => {
  test('applying twice is the same as applying once', () => {
    const inputs = [
      '/tmp/abc/x',
      '/var/folders/q/w/T/abc/y',
      'C:\\Users\\steve\\AppData\\Local\\Temp\\foo\\z',
      '--config=/tmp/abc/x.json',
      'no-tmp-here',
    ]
    for (const s of inputs) {
      const once = normalizeTmpPath(s)
      const twice = normalizeTmpPath(once)
      expect(twice).toBe(once)
    }
  })
})
