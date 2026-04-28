import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const FIXTURE = path.resolve('tests/fixtures/cassettes/v2-dirty.json')
const CLI = path.resolve('dist/bin.js')

// Skip the suite if dist isn't built so local `npm test` works without a prior
// `npm run build`. CI builds before test, so all tests run there.
const HAS_BUILT_CLI = existsSync(CLI)

/**
 * Build a Readable stream that emits each line with a small delay between
 * pushes. Required because Node's `readline.question` can drop a queued
 * answer if stdin EOFs before the next `question()` call is registered.
 * A 30ms gap gives the CLI time to render its prompt and re-register.
 */
function pacedStdin(lines: readonly string[]): Readable {
  let i = 0
  return new Readable({
    read() {
      if (i >= lines.length) {
        // Delay EOF too so the final answer has time to land before stdin closes.
        setTimeout(() => this.push(null), 100)
        return
      }
      const line = lines[i]
      i++
      setTimeout(() => this.push(`${line}\n`), 100)
    },
  })
}

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-review-e2e-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

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
    const targetPath = path.join(tmp, 'review.json')
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
    const targetPath = path.join(tmp, 'review-quit.json')
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
