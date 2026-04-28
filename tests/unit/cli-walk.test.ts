import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { walkCassettes } from '../../src/cli-walk.js'
import { CassetteIOError } from '../../src/errors.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-walk-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('walkCassettes', () => {
  test('single existing file path returned as-is', async () => {
    const cassettePath = path.join(tmp, 'foo.json')
    await writeFile(cassettePath, JSON.stringify({ version: 2, recordings: [] }))
    const result = await walkCassettes([cassettePath])
    expect(result).toEqual([cassettePath])
  })

  test('directory walked for *.json files matching cassette schema', async () => {
    const a = path.join(tmp, 'a.json')
    const b = path.join(tmp, 'b.json')
    const c = path.join(tmp, 'c.json')
    await writeFile(a, JSON.stringify({ version: 1, recordings: [] }))
    await writeFile(b, JSON.stringify({ version: 2, recordings: [] }))
    await writeFile(c, JSON.stringify({ unrelated: true })) // not a cassette
    const result = await walkCassettes([tmp])
    expect(result.sort()).toEqual([a, b].sort())
  })

  test('directory walked recursively', async () => {
    const subdir = path.join(tmp, 'sub')
    await mkdir(subdir, { recursive: true })
    const nested = path.join(subdir, 'nested.json')
    await writeFile(nested, JSON.stringify({ version: 2, recordings: [] }))
    const result = await walkCassettes([tmp])
    expect(result).toContain(nested)
  })

  test('mixed paths: file + directory de-duplicated', async () => {
    const a = path.join(tmp, 'a.json')
    await writeFile(a, JSON.stringify({ version: 2, recordings: [] }))
    const result = await walkCassettes([a, tmp])
    expect(result.length).toBe(1)
    expect(result[0]).toBe(a)
  })

  test('non-existent path throws CassetteIOError', async () => {
    await expect(walkCassettes([path.join(tmp, 'nope.json')])).rejects.toThrow(CassetteIOError)
  })

  test('non-cassette JSON in dir is silently skipped', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'foo' }))
    const result = await walkCassettes([tmp])
    expect(result).toEqual([])
  })

  test('malformed JSON in dir is silently skipped (not a cassette)', async () => {
    await writeFile(path.join(tmp, 'broken.json'), '{invalid json')
    const result = await walkCassettes([tmp])
    expect(result).toEqual([])
  })

  test('non-.json files in dir are skipped', async () => {
    await writeFile(path.join(tmp, 'readme.txt'), 'hello')
    const result = await walkCassettes([tmp])
    expect(result).toEqual([])
  })

  test('JSON file with version field other than 1 or 2 in dir is skipped', async () => {
    await writeFile(path.join(tmp, 'v3.json'), JSON.stringify({ version: 3, recordings: [] }))
    const result = await walkCassettes([tmp])
    expect(result).toEqual([])
  })

  test('empty paths array returns empty result', async () => {
    const result = await walkCassettes([])
    expect(result).toEqual([])
  })

  test('explicit file path bypasses cassette filter (caller knows what they want)', async () => {
    // This test verifies the design choice: explicit paths are trusted.
    // Walking a directory filters; passing a file directly does not.
    const explicit = path.join(tmp, 'config.json')
    await writeFile(explicit, JSON.stringify({ name: 'package' }))
    const result = await walkCassettes([explicit])
    expect(result).toEqual([explicit])
  })
})
