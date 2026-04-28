import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Canonicalize } from '../../src/types.js'
import { useCassette } from '../../src/use-cassette.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

describe('useCassette - argcount dispatch', () => {
  const tmpDir = useTmpDir()

  test('2-arg form: useCassette(path, fn) works (no options)', async () => {
    let called = false
    await useCassette(path.join(tmpDir.ref(), 'a.json'), async () => {
      called = true
    })
    expect(called).toBe(true)
  })

  test('3-arg form: useCassette(path, options, fn) works (with options)', async () => {
    let called = false
    const customCanonicalize: Canonicalize = (call) => ({ command: call.command })
    await useCassette(
      path.join(tmpDir.ref(), 'b.json'),
      { canonicalize: customCanonicalize },
      async () => {
        called = true
      },
    )
    expect(called).toBe(true)
  })

  test('3-arg form with empty options object', async () => {
    let called = false
    await useCassette(path.join(tmpDir.ref(), 'c.json'), {}, async () => {
      called = true
    })
    expect(called).toBe(true)
  })
})
