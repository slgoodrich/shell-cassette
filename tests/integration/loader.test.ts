import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { CassetteCorruptError, ShellCassetteError } from '../../src/errors.js'
import { loadCassette } from '../../src/loader.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

describe('loadCassette', () => {
  const tmpDir = useTmpDir()

  test('returns null when file does not exist', async () => {
    const result = await loadCassette(path.join(tmpDir.ref(), 'missing.json'))
    expect(result).toBeNull()
  })

  test('parses valid cassette file', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await writeFile(target, JSON.stringify({ version: 1, recordings: [] }), 'utf8')
    const result = await loadCassette(target)
    expect(result).not.toBeNull()
    expect(result?.version).toBe(1)
    expect(result?.recordings).toEqual([])
  })

  test('throws CassetteCorruptError on bad JSON', async () => {
    const target = path.join(tmpDir.ref(), 'bad.json')
    await writeFile(target, '{ not json', 'utf8')
    const result = loadCassette(target)
    await expect(result).rejects.toThrow(CassetteCorruptError)
    await expect(result).rejects.toThrow(ShellCassetteError)
  })

  test('throws CassetteCorruptError on unknown version', async () => {
    const target = path.join(tmpDir.ref(), 'unknown.json')
    await writeFile(target, JSON.stringify({ version: 99 }), 'utf8')
    const result = loadCassette(target)
    await expect(result).rejects.toThrow(CassetteCorruptError)
    await expect(result).rejects.toThrow(ShellCassetteError)
  })
})
