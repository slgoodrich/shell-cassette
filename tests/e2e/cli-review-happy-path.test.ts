import { copyFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { describe, expect, test } from 'vitest'
import { CLI, HAS_BUILT_CLI } from '../helpers/cli-e2e.js'
import { pacedStdin } from '../helpers/paced-stdin.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const FIXTURE = path.resolve('tests/fixtures/cassettes/v2-dirty.json')

const tmp = useTmpDir('shell-cassette-review-e2e-')

describe.skipIf(!HAS_BUILT_CLI)('cli review e2e', () => {
  test('--json mode emits reviewVersion: 1 with findings', async () => {
    const r = await execa('node', [CLI, 'review', FIXTURE, '--json', '--no-color'])
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.reviewVersion).toBe(1)
    expect(parsed.summary.totalFindings).toBeGreaterThan(0)
    expect(parsed.findings.length).toBeGreaterThan(0)
  })

  test('interactive accept-then-confirm: drives stdin and writes redacted cassette', async () => {
    const targetPath = path.join(tmp.ref(), 'review.json')
    await copyFile(FIXTURE, targetPath)

    // Provide stdin: 'a' (accept the one finding) then 'y' (confirm apply).
    // Use pacedStdin to avoid readline's EOF-vs-next-question race.
    const r = await execa('node', [CLI, 'review', targetPath, '--no-color'], {
      input: pacedStdin(['a', 'y']),
      reject: false,
    })
    expect(r.exitCode).toBe(0)

    const updated = JSON.parse(await readFile(targetPath, 'utf8'))
    // The fixture's PAT lives in args[1] of the curl call. After accept, the
    // arg should contain a counter-tagged placeholder.
    const arg = updated.recordings[0].call.args[1]
    expect(arg).toMatch(/<redacted:args:github-pat-classic:\d+>/)
  })

  test('interactive quit: cassette unchanged on disk', async () => {
    const targetPath = path.join(tmp.ref(), 'review-quit.json')
    await copyFile(FIXTURE, targetPath)
    const before = await readFile(targetPath, 'utf8')

    const r = await execa('node', [CLI, 'review', targetPath, '--no-color'], {
      input: pacedStdin(['q']),
      reject: false,
    })
    expect(r.exitCode).toBe(0)
    expect(await readFile(targetPath, 'utf8')).toBe(before)
  })

  test('exit 2 on missing path', async () => {
    const r = await execa('node', [CLI, 'review'], { reject: false })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/review requires a path/)
  })
})
