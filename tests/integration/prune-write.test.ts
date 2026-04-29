import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { runPrune } from '../../src/cli-prune.js'
import { deserialize } from '../../src/serialize.js'

let tmp: string
let outBuf: string[]
let errBuf: string[]
const origStdout = process.stdout.write.bind(process.stdout)
const origStderr = process.stderr.write.bind(process.stderr)

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-prune-write-'))
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

describe('prune write (integration)', () => {
  test('--delete 0 produces a cassette that round-trips through deserialize as valid v2', async () => {
    const fix = await copyFixture()
    await runPrune([fix, '--delete', '0'])
    const updated = deserialize(await readFile(fix, 'utf8'))
    expect(updated.version).toBe(2)
    expect(updated.recordings).toHaveLength(2)
    expect(updated.recordings[0]?.call.args).toEqual(['two'])
    expect(updated.recordings[1]?.call.args).toEqual(['three'])
  })

  test('--delete refreshes recordedBy stamp to current shell-cassette identity', async () => {
    const fix = await copyFixture()
    await runPrune([fix, '--delete', '0'])
    const updated = deserialize(await readFile(fix, 'utf8'))
    expect(updated.recordedBy?.name).toBe('shell-cassette')
    expect(updated.recordedBy?.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('out-of-range index does NOT modify the file', async () => {
    const fix = await copyFixture()
    const before = await readFile(fix, 'utf8')
    expect(await runPrune([fix, '--delete', '99'])).toBe(2)
    expect(await readFile(fix, 'utf8')).toBe(before)
  })

  test('duplicate index does NOT modify the file', async () => {
    const fix = await copyFixture()
    const before = await readFile(fix, 'utf8')
    expect(await runPrune([fix, '--delete', '0,0'])).toBe(2)
    expect(await readFile(fix, 'utf8')).toBe(before)
  })
})
