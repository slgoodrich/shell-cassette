import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { readCassetteFile, writeCassetteFile } from '../../src/io.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

describe('writeCassetteFile (atomic)', () => {
  const tmpDir = useTmpDir()

  test('writes content to path', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await writeCassetteFile(target, '{"hello":"world"}')
    const content = await readFile(target, 'utf8')
    expect(content).toBe('{"hello":"world"}')
  })

  test('creates parent directories on demand', async () => {
    const target = path.join(tmpDir.ref(), 'a', 'b', 'c', 'foo.json')
    await writeCassetteFile(target, '{}')
    const content = await readFile(target, 'utf8')
    expect(content).toBe('{}')
  })

  test('overwrites existing file atomically', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await writeCassetteFile(target, 'first')
    await writeCassetteFile(target, 'second')
    const content = await readFile(target, 'utf8')
    expect(content).toBe('second')
  })

  test('cleans up temp file on success', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await writeCassetteFile(target, '{}')
    const dirEntries = await readDirectory(path.dirname(target))
    expect(dirEntries.filter((e) => e.includes('.tmp.'))).toHaveLength(0)
  })
})

describe('readCassetteFile', () => {
  const tmpDir = useTmpDir()

  test('returns string content for existing file', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await writeCassetteFile(target, 'hello')
    const result = await readCassetteFile(target)
    expect(result).toBe('hello')
  })

  test('returns null for missing file', async () => {
    const target = path.join(tmpDir.ref(), 'missing.json')
    const result = await readCassetteFile(target)
    expect(result).toBeNull()
  })
})

async function readDirectory(p: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return readdir(p)
}
