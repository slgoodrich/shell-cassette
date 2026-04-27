import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Canonicalize } from '../../src/types.js'
import { useCassette } from '../../src/use-cassette.js'

describe('useCassette - argcount dispatch', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('2-arg form: useCassette(path, fn) works (no options)', async () => {
    let called = false
    await useCassette(path.join(tmp, 'a.json'), async () => {
      called = true
    })
    expect(called).toBe(true)
  })

  test('3-arg form: useCassette(path, options, fn) works (with options)', async () => {
    let called = false
    const customCanonicalize: Canonicalize = (call) => ({ command: call.command })
    await useCassette(path.join(tmp, 'b.json'), { canonicalize: customCanonicalize }, async () => {
      called = true
    })
    expect(called).toBe(true)
  })

  test('3-arg form with empty options object', async () => {
    let called = false
    await useCassette(path.join(tmp, 'c.json'), {}, async () => {
      called = true
    })
    expect(called).toBe(true)
  })
})
