import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, test } from 'vitest'

const als = new AsyncLocalStorage<string>()

describe('vitest ALS behavior (regression guard)', () => {
  test('als.run wrapping test body works', async () => {
    await als.run('value-a', async () => {
      expect(als.getStore()).toBe('value-a')
      await new Promise((r) => setTimeout(r, 5))
      expect(als.getStore()).toBe('value-a')
    })
  })

  test.concurrent('als.run isolates concurrent test A', async () => {
    await als.run('concurrent-a', async () => {
      expect(als.getStore()).toBe('concurrent-a')
      await new Promise((r) => setTimeout(r, 50))
      expect(als.getStore()).toBe('concurrent-a')
    })
  })

  test.concurrent('als.run isolates concurrent test B', async () => {
    await als.run('concurrent-b', async () => {
      expect(als.getStore()).toBe('concurrent-b')
      await new Promise((r) => setTimeout(r, 50))
      expect(als.getStore()).toBe('concurrent-b')
    })
  })

  test('als.run nesting produces correct lookup', async () => {
    await als.run('outer', async () => {
      expect(als.getStore()).toBe('outer')
      await als.run('inner', async () => {
        expect(als.getStore()).toBe('inner')
      })
      expect(als.getStore()).toBe('outer')
    })
  })
})
