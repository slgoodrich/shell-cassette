import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { BinaryInputError, CassetteIOError, ShellCassetteError } from '../../src/errors.js'
import { buildCall } from '../../src/execa.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

describe('buildCall stdin extraction', () => {
  const tmp = useTmpDir()

  test('produces stdin: null when neither input nor inputFile is set', async () => {
    const call = await buildCall('node', ['-v'], {})
    expect(call.stdin).toBeNull()
    expect(call.command).toBe('node')
    expect(call.args).toEqual(['-v'])
  })

  test('extracts stdin from input: string', async () => {
    const call = await buildCall('cat', [], { input: 'hello' })
    expect(call.stdin).toBe('hello')
  })

  test('extracts empty string from input: ""', async () => {
    const call = await buildCall('cat', [], { input: '' })
    expect(call.stdin).toBe('')
  })

  test('reads inputFile contents into stdin', async () => {
    const file = path.join(tmp.ref(), 'stdin.txt')
    await writeFile(file, 'from-file', 'utf8')
    const call = await buildCall('cat', [], { inputFile: file })
    expect(call.stdin).toBe('from-file')
  })

  test('reads inputFile content with newlines verbatim (no normalization)', async () => {
    const file = path.join(tmp.ref(), 'multi.txt')
    await writeFile(file, 'a\nb\r\nc\n', 'utf8')
    const call = await buildCall('cat', [], { inputFile: file })
    expect(call.stdin).toBe('a\nb\r\nc\n')
  })

  test('throws CassetteIOError when inputFile does not exist', async () => {
    const missing = path.join(tmp.ref(), 'nope.txt')
    try {
      await buildCall('cat', [], { inputFile: missing })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(CassetteIOError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain(missing)
    }
  })

  test('throws BinaryInputError when inputFile is non-UTF-8', async () => {
    const file = path.join(tmp.ref(), 'binary.bin')
    // Lone 0xC3 is an invalid UTF-8 start byte without a valid continuation.
    await writeFile(file, Buffer.from([0xc3, 0x28]))
    try {
      await buildCall('cat', [], { inputFile: file })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(BinaryInputError)
      expect(e).toBeInstanceOf(ShellCassetteError)
      expect((e as Error).message).toContain(file)
    }
  })

  test('cwd and env extraction unaffected by stdin path', async () => {
    const call = await buildCall('cat', [], {
      input: 'x',
      cwd: '/tmp',
      env: { FOO: 'bar' },
    })
    expect(call.cwd).toBe('/tmp')
    expect(call.env).toEqual({ FOO: 'bar' })
    expect(call.stdin).toBe('x')
  })
})
