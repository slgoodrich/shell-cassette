import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CassetteCorruptError } from '../../src/errors.js'
import { loadCassette } from '../../src/loader.js'

describe('loadCassette', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('returns null when file does not exist', async () => {
    const result = await loadCassette(path.join(tmp, 'missing.json'))
    expect(result).toBeNull()
  })

  test('parses valid cassette file', async () => {
    const target = path.join(tmp, 'foo.json')
    await writeFile(target, JSON.stringify({ version: 1, recordings: [] }), 'utf8')
    const result = await loadCassette(target)
    expect(result).not.toBeNull()
    expect(result?.version).toBe(1)
    expect(result?.recordings).toEqual([])
  })

  test('throws CassetteCorruptError on bad JSON', async () => {
    const target = path.join(tmp, 'bad.json')
    await writeFile(target, '{ not json', 'utf8')
    await expect(loadCassette(target)).rejects.toThrow(CassetteCorruptError)
  })

  test('throws CassetteCorruptError on unknown version', async () => {
    const target = path.join(tmp, 'unknown.json')
    await writeFile(target, JSON.stringify({ version: 99 }), 'utf8')
    await expect(loadCassette(target)).rejects.toThrow(CassetteCorruptError)
  })
})
