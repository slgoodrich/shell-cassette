import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const FIXTURE = path.resolve('tests/fixtures/cassettes/v2-multi-recording-for-prune.json')
const CLI = path.resolve('dist/bin.js')

const HAS_BUILT_CLI = existsSync(CLI)

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-prune-e2e-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe.skipIf(!HAS_BUILT_CLI)('cli prune e2e', () => {
  test('--json mode emits pruneVersion: 1', async () => {
    const r = await execa('node', [CLI, 'prune', FIXTURE, '--json'])
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.pruneVersion).toBe(1)
    expect(parsed.recordings).toHaveLength(3)
  })

  test('--delete 0,2 removes recordings 0 and 2', async () => {
    const targetPath = path.join(tmp, 'prune.json')
    await copyFile(FIXTURE, targetPath)
    const r = await execa('node', [CLI, 'prune', targetPath, '--delete', '0,2'])
    expect(r.exitCode).toBe(0)
    const after = JSON.parse(await readFile(targetPath, 'utf8'))
    expect(after.recordings).toHaveLength(1)
    expect(after.recordings[0].call.args).toEqual(['two'])
  })

  test('exit 2 on out-of-range index', async () => {
    const targetPath = path.join(tmp, 'prune-bad.json')
    await copyFile(FIXTURE, targetPath)
    const r = await execa('node', [CLI, 'prune', targetPath, '--delete', '99'], { reject: false })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/out of range/)
  })

  test('exit 2 on bare prune <path> (no flags)', async () => {
    const r = await execa('node', [CLI, 'prune', FIXTURE], { reject: false })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/--delete <indexes> or --json/)
  })

  test('--help returns 0', async () => {
    const r = await execa('node', [CLI, 'prune', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/--delete <indexes>/)
  })
})
