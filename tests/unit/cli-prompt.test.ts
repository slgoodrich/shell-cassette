import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  promptAction,
  promptText,
  promptYesNo,
  type Reader,
  setReader,
} from '../../src/cli-prompt.js'

function makeReader(answers: string[]): Reader {
  const queue = [...answers]
  return {
    question: vi.fn(async () => {
      const next = queue.shift()
      if (next === undefined) throw new Error('reader: no more answers queued')
      return next
    }),
    close: vi.fn(),
  }
}

afterEach(() => {
  setReader(null)
})

describe('promptAction', () => {
  test('returns the lowercased trimmed key when valid', async () => {
    setReader(makeReader([' A ']))
    expect(await promptAction(['a', 's', 'q'])).toBe('a')
  })

  test('re-prompts on invalid key', async () => {
    setReader(makeReader(['x', 'q']))
    expect(await promptAction(['a', 's', 'q'])).toBe('q')
  })

  test('accepts the special help key `?`', async () => {
    setReader(makeReader(['?']))
    expect(await promptAction(['a', 's', 'q', '?'])).toBe('?')
  })
})

describe('promptText', () => {
  test('returns trimmed input', async () => {
    setReader(makeReader(['  hello world  ']))
    expect(await promptText('Replacement:')).toBe('hello world')
  })

  test('returns empty string when user just hits enter', async () => {
    setReader(makeReader(['']))
    expect(await promptText('Replacement:')).toBe('')
  })
})

describe('promptYesNo', () => {
  test('y returns true', async () => {
    setReader(makeReader(['y']))
    expect(await promptYesNo('OK?')).toBe(true)
  })

  test('yes returns true', async () => {
    setReader(makeReader(['YES']))
    expect(await promptYesNo('OK?')).toBe(true)
  })

  test('empty input returns false (default-no)', async () => {
    setReader(makeReader(['']))
    expect(await promptYesNo('OK?')).toBe(false)
  })

  test('n returns false', async () => {
    setReader(makeReader(['n']))
    expect(await promptYesNo('OK?')).toBe(false)
  })

  test('re-prompts on garbage input', async () => {
    setReader(makeReader(['lol', 'maybe', 'y']))
    expect(await promptYesNo('OK?')).toBe(true)
  })
})
