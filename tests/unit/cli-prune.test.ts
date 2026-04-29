import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parsePruneArgs, runPrune } from '../../src/cli-prune.js'

describe('parsePruneArgs', () => {
  test('--delete 0,2 parsed as [0, 2]', () => {
    expect(parsePruneArgs(['./f.json', '--delete', '0,2']).delete).toEqual([0, 2])
  })

  test('--delete=0,2 parsed', () => {
    expect(parsePruneArgs(['./f.json', '--delete=0,2']).delete).toEqual([0, 2])
  })

  test('--json sets json: true', () => {
    expect(parsePruneArgs(['./f.json', '--json']).json).toBe(true)
  })

  test('--quiet sets quiet: true', () => {
    expect(parsePruneArgs(['./f.json', '--quiet', '--delete', '0']).quiet).toBe(true)
  })

  test('--help', () => {
    expect(parsePruneArgs(['--help']).help).toBe(true)
  })

  test('throws on unknown flag', () => {
    expect(() => parsePruneArgs(['./f.json', '--bogus'])).toThrow(/unknown flag/)
  })

  test('throws on more than one path', () => {
    expect(() => parsePruneArgs(['a.json', 'b.json'])).toThrow(/exactly one path/)
  })

  test('throws when --delete value is non-numeric', () => {
    expect(() => parsePruneArgs(['./f.json', '--delete', '0,abc'])).toThrow(
      /not a non-negative integer/,
    )
  })
})

describe('runPrune', () => {
  let tmp: string
  let outBuf: string[]
  let errBuf: string[]
  const origStdout = process.stdout.write.bind(process.stdout)
  const origStderr = process.stderr.write.bind(process.stderr)

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-prune-'))
    outBuf = []
    errBuf = []
    process.stdout.write = ((s: string) => {
      outBuf.push(s)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((s: string) => {
      errBuf.push(s)
      return true
    }) as typeof process.stderr.write
  })
  afterEach(async () => {
    process.stdout.write = origStdout
    process.stderr.write = origStderr
    await rm(tmp, { recursive: true, force: true })
  })

  async function copyFixture(): Promise<string> {
    const src = path.resolve('tests/fixtures/cassettes/v2-multi-recording-for-prune.json')
    const dst = path.join(tmp, 'fix.json')
    await writeFile(dst, await readFile(src, 'utf8'))
    return dst
  }

  test('--json emits pruneVersion: 1 with all recordings listed', async () => {
    const fix = await copyFixture()
    expect(await runPrune([fix, '--json'])).toBe(0)
    const out = JSON.parse(outBuf.join(''))
    expect(out.pruneVersion).toBe(1)
    expect(out.recordings).toHaveLength(3)
    expect(out.recordings[0]).toMatchObject({
      index: 0,
      command: 'echo',
      args: ['one'],
      exitCode: 0,
    })
  })

  test('--delete 1 removes the second recording', async () => {
    const fix = await copyFixture()
    expect(await runPrune([fix, '--delete', '1'])).toBe(0)
    const after = JSON.parse(await readFile(fix, 'utf8'))
    expect(after.recordings).toHaveLength(2)
    expect(after.recordings[0].call.args).toEqual(['one'])
    expect(after.recordings[1].call.args).toEqual(['three'])
  })

  test('--delete 0,2 removes recordings 0 and 2', async () => {
    const fix = await copyFixture()
    expect(await runPrune([fix, '--delete', '0,2'])).toBe(0)
    const after = JSON.parse(await readFile(fix, 'utf8'))
    expect(after.recordings).toHaveLength(1)
    expect(after.recordings[0].call.args).toEqual(['two'])
  })

  test('--delete with out-of-range index exits 2', async () => {
    const fix = await copyFixture()
    expect(await runPrune([fix, '--delete', '99'])).toBe(2)
    expect(errBuf.join('')).toMatch(/index 99 out of range/)
  })

  test('--delete with duplicate index exits 2', async () => {
    const fix = await copyFixture()
    expect(await runPrune([fix, '--delete', '0,0'])).toBe(2)
    expect(errBuf.join('')).toMatch(/duplicate index/)
  })

  test('bare prune <path> (no flags) exits 2 with guidance', async () => {
    const fix = await copyFixture()
    expect(await runPrune([fix])).toBe(2)
    expect(errBuf.join('')).toMatch(/--delete <indexes> or --json/)
  })

  test('--help returns 0', async () => {
    expect(await runPrune(['--help'])).toBe(0)
    expect(outBuf.join('')).toContain('Usage:')
  })

  test('exit 2 on missing path entirely', async () => {
    expect(await runPrune([])).toBe(2)
    expect(errBuf.join('')).toMatch(/prune requires a path/)
  })

  test('--quiet --delete 0 suppresses stdout summary', async () => {
    const fix = await copyFixture()
    outBuf.length = 0
    expect(await runPrune([fix, '--delete', '0', '--quiet'])).toBe(0)
    expect(outBuf.join('')).toBe('')
  })
})
