import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readCassetteFile, writeCassetteFile } from '../../src/io.js'

describe('writeCassetteFile (atomic)', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('writes content to path', async () => {
    const target = path.join(tmp, 'foo.json')
    await writeCassetteFile(target, '{"hello":"world"}')
    const content = await readFile(target, 'utf8')
    expect(content).toBe('{"hello":"world"}')
  })

  test('creates parent directories on demand', async () => {
    const target = path.join(tmp, 'a', 'b', 'c', 'foo.json')
    await writeCassetteFile(target, '{}')
    const content = await readFile(target, 'utf8')
    expect(content).toBe('{}')
  })

  test('overwrites existing file atomically', async () => {
    const target = path.join(tmp, 'foo.json')
    await writeCassetteFile(target, 'first')
    await writeCassetteFile(target, 'second')
    const content = await readFile(target, 'utf8')
    expect(content).toBe('second')
  })

  test('cleans up temp file on success', async () => {
    const target = path.join(tmp, 'foo.json')
    await writeCassetteFile(target, '{}')
    const dirEntries = await readDirectory(path.dirname(target))
    expect(dirEntries.filter((e) => e.includes('.tmp.'))).toHaveLength(0)
  })
})

describe('readCassetteFile', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('returns string content for existing file', async () => {
    const target = path.join(tmp, 'foo.json')
    await writeCassetteFile(target, 'hello')
    const result = await readCassetteFile(target)
    expect(result).toBe('hello')
  })

  test('returns null for missing file', async () => {
    const target = path.join(tmp, 'missing.json')
    const result = await readCassetteFile(target)
    expect(result).toBeNull()
  })
})

async function readDirectory(p: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return readdir(p)
}
