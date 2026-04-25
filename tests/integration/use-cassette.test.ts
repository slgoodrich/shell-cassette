import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
})

afterEach(() => {
  if (originalAck === undefined) {
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
  } else {
    process.env.SHELL_CASSETTE_ACK_REDACTION = originalAck
  }
})

describe('useCassette', () => {
  test('records execa calls and writes cassette at scope end', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const cassettePath = path.join(tmp, '__cassettes__', 'test.json')

      await useCassette(cassettePath, async () => {
        await execa('node', ['-e', 'console.log("hi")'])
      })

      const content = await readFile(cassettePath, 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.version).toBe(1)
      expect(parsed.recordings).toHaveLength(1)
      expect(parsed.recordings[0].call.command).toBe('node')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('does not write cassette if no execa calls happened', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const cassettePath = path.join(tmp, '__cassettes__', 'empty.json')
      await useCassette(cassettePath, async () => {
        // no execa calls
      })
      await expect(readFile(cassettePath, 'utf8')).rejects.toThrow()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('writes cassette even if callback throws', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const cassettePath = path.join(tmp, '__cassettes__', 'partial.json')
      await expect(
        useCassette(cassettePath, async () => {
          await execa('node', ['-e', 'console.log("recorded before throw")'])
          throw new Error('test failure')
        }),
      ).rejects.toThrow('test failure')

      const content = await readFile(cassettePath, 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.recordings).toHaveLength(1)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('replays from existing cassette in subsequent calls', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-test-'))
    try {
      const cassettePath = path.join(tmp, '__cassettes__', 'replay.json')

      // First run: record
      await useCassette(cassettePath, async () => {
        await execa('node', ['-e', 'console.log("recorded")'])
      })

      // Second run: should replay (no real subprocess)
      await useCassette(cassettePath, async () => {
        const result = await execa('node', ['-e', 'console.log("recorded")'])
        expect(result.stdout).toContain('recorded')
      })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
