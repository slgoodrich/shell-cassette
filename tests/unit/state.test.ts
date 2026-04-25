import { afterEach, describe, expect, test } from 'vitest'
import { CassetteCollisionError } from '../../src/errors.js'
import {
  clearActiveCassette,
  getActiveCassette,
  registerSessionPath,
  setActiveCassette,
  unregisterSessionPath,
  withCassette,
} from '../../src/state.js'
import type { CassetteSession } from '../../src/types.js'

const sessionAt = (path: string): CassetteSession => ({
  name: `s-${path}`,
  path,
  scopeDefault: 'auto',
  loadedFile: null,
  matcher: null,
  newRecordings: [],
})

afterEach(() => {
  clearActiveCassette()
})

describe('module-global active cassette', () => {
  test('returns null when nothing set', () => {
    expect(getActiveCassette()).toBeNull()
  })

  test('returns set value', () => {
    const s = sessionAt('/tmp/x.json')
    setActiveCassette(s)
    expect(getActiveCassette()).toBe(s)
  })

  test('clear resets to null', () => {
    setActiveCassette(sessionAt('/tmp/x.json'))
    clearActiveCassette()
    expect(getActiveCassette()).toBeNull()
  })
})

describe('ALS active cassette via withCassette', () => {
  test('inside withCassette, returns ALS session', async () => {
    const s = sessionAt('/tmp/als.json')
    const result = await withCassette(s, async () => getActiveCassette())
    expect(result).toBe(s)
  })

  test('after withCassette returns, ALS session is gone', async () => {
    await withCassette(sessionAt('/tmp/als.json'), async () => 'done')
    expect(getActiveCassette()).toBeNull()
  })

  test('ALS wins over module global', async () => {
    const moduleSession = sessionAt('/tmp/module.json')
    const alsSession = sessionAt('/tmp/als.json')
    setActiveCassette(moduleSession)
    const inside = await withCassette(alsSession, async () => getActiveCassette())
    expect(inside).toBe(alsSession)
    expect(getActiveCassette()).toBe(moduleSession)
  })

  test('nested withCassette works (inner wins)', async () => {
    const outer = sessionAt('/tmp/outer.json')
    const inner = sessionAt('/tmp/inner.json')
    const result = await withCassette(outer, async () =>
      withCassette(inner, async () => getActiveCassette()),
    )
    expect(result).toBe(inner)
  })
})

describe('CassetteCollisionError detection via path map', () => {
  test('registering same path twice throws', () => {
    registerSessionPath('/tmp/foo.json', 'opener-a')
    expect(() => registerSessionPath('/tmp/foo.json', 'opener-b')).toThrow(CassetteCollisionError)
    unregisterSessionPath('/tmp/foo.json')
  })

  test('after unregister, can register again', () => {
    registerSessionPath('/tmp/foo.json', 'opener-a')
    unregisterSessionPath('/tmp/foo.json')
    expect(() => registerSessionPath('/tmp/foo.json', 'opener-b')).not.toThrow()
    unregisterSessionPath('/tmp/foo.json')
  })
})
