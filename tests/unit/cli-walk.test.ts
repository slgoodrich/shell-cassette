import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { walkCassettes } from '../../src/cli-walk.js'
import { CassetteIOError } from '../../src/errors.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const tmpDir = useTmpDir('shell-cassette-walk-')

describe('walkCassettes', () => {
  test('single existing file path returned as-is', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'foo.json')
    await writeFile(cassettePath, JSON.stringify({ version: 2, recordings: [] }))
    const result = await walkCassettes([cassettePath])
    expect(result).toEqual([cassettePath])
  })

  test('directory walked for *.json files matching cassette schema', async () => {
    const a = path.join(tmpDir.ref(), 'a.json')
    const b = path.join(tmpDir.ref(), 'b.json')
    const c = path.join(tmpDir.ref(), 'c.json')
    await writeFile(a, JSON.stringify({ version: 1, recordings: [] }))
    await writeFile(b, JSON.stringify({ version: 2, recordings: [] }))
    await writeFile(c, JSON.stringify({ unrelated: true })) // not a cassette
    const result = await walkCassettes([tmpDir.ref()])
    expect(result.sort()).toEqual([a, b].sort())
  })

  test('directory walked recursively', async () => {
    const subdir = path.join(tmpDir.ref(), 'sub')
    await mkdir(subdir, { recursive: true })
    const nested = path.join(subdir, 'nested.json')
    await writeFile(nested, JSON.stringify({ version: 2, recordings: [] }))
    const result = await walkCassettes([tmpDir.ref()])
    expect(result).toContain(nested)
  })

  test('mixed paths: file + directory de-duplicated', async () => {
    const a = path.join(tmpDir.ref(), 'a.json')
    await writeFile(a, JSON.stringify({ version: 2, recordings: [] }))
    const result = await walkCassettes([a, tmpDir.ref()])
    expect(result.length).toBe(1)
    expect(result[0]).toBe(a)
  })

  test('non-existent path throws CassetteIOError', async () => {
    await expect(walkCassettes([path.join(tmpDir.ref(), 'nope.json')])).rejects.toThrow(
      CassetteIOError,
    )
  })

  test('non-cassette JSON in dir is silently skipped', async () => {
    await writeFile(path.join(tmpDir.ref(), 'package.json'), JSON.stringify({ name: 'foo' }))
    const result = await walkCassettes([tmpDir.ref()])
    expect(result).toEqual([])
  })

  test('malformed JSON in dir is silently skipped (not a cassette)', async () => {
    await writeFile(path.join(tmpDir.ref(), 'broken.json'), '{invalid json')
    const result = await walkCassettes([tmpDir.ref()])
    expect(result).toEqual([])
  })

  test('non-.json files in dir are skipped', async () => {
    await writeFile(path.join(tmpDir.ref(), 'readme.txt'), 'hello')
    const result = await walkCassettes([tmpDir.ref()])
    expect(result).toEqual([])
  })

  test('JSON file with version field other than 1 or 2 in dir is skipped', async () => {
    await writeFile(
      path.join(tmpDir.ref(), 'v3.json'),
      JSON.stringify({ version: 3, recordings: [] }),
    )
    const result = await walkCassettes([tmpDir.ref()])
    expect(result).toEqual([])
  })

  test('empty paths array returns empty result', async () => {
    const result = await walkCassettes([])
    expect(result).toEqual([])
  })

  test('explicit file path bypasses cassette filter (caller knows what they want)', async () => {
    // This test verifies the design choice: explicit paths are trusted.
    // Walking a directory filters; passing a file directly does not.
    const explicit = path.join(tmpDir.ref(), 'config.json')
    await writeFile(explicit, JSON.stringify({ name: 'package' }))
    const result = await walkCassettes([explicit])
    expect(result).toEqual([explicit])
  })
})
