import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import { BinaryInputError, CassetteIOError, ShellCassetteError } from '../../src/errors.js'
import { readCassetteFile, readInputFile, writeCassetteFile } from '../../src/io.js'
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

describe('readInputFile', () => {
  const tmpDir = useTmpDir()

  test('returns UTF-8 string verbatim', async () => {
    const target = path.join(tmpDir.ref(), 'in.txt')
    await writeFile(target, 'hello world', 'utf8')
    const result = await readInputFile(target)
    expect(result).toBe('hello world')
  })

  test('preserves multibyte UTF-8 content without truncation', async () => {
    const target = path.join(tmpDir.ref(), 'in.txt')
    const value = 'héllo 世界 🎉'
    await writeFile(target, value, 'utf8')
    const result = await readInputFile(target)
    expect(result).toBe(value)
  })

  test('accepts a URL path (string | URL signature)', async () => {
    const target = path.join(tmpDir.ref(), 'in.txt')
    const value = 'from a URL'
    await writeFile(target, value, 'utf8')
    const result = await readInputFile(pathToFileURL(target))
    expect(result).toBe(value)
  })

  test('throws BinaryInputError on non-UTF-8 bytes', async () => {
    const target = path.join(tmpDir.ref(), 'in.bin')
    await writeFile(target, Buffer.from([0xff, 0xfe, 0x00, 0x01]))
    let caught: unknown
    try {
      await readInputFile(target)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(BinaryInputError)
    expect(caught).toBeInstanceOf(ShellCassetteError)
    expect((caught as Error).message).toContain(target)
    expect((caught as Error).message).toContain('non-UTF-8')
  })

  test('throws CassetteIOError when the file does not exist, preserving cause', async () => {
    const target = path.join(tmpDir.ref(), 'missing.txt')
    let caught: unknown
    try {
      await readInputFile(target)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CassetteIOError)
    expect(caught).toBeInstanceOf(ShellCassetteError)
    expect((caught as Error).message).toContain(target)
    const cause = (caught as { cause: NodeJS.ErrnoException }).cause
    expect(cause).toBeDefined()
    expect(cause.code).toBe('ENOENT')
  })
})

async function readDirectory(p: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return readdir(p)
}
