import { existsSync } from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { describe, expect, test } from 'vitest'

const FIXTURE = path.resolve('tests/fixtures/cassettes/v2-with-findings-for-review.json')
const CLI = path.resolve('dist/bin.js')

// Skip the suite if dist isn't built so local `npm test` works without a prior
// `npm run build`. CI builds before test, so all tests run there.
const HAS_BUILT_CLI = existsSync(CLI)

describe.skipIf(!HAS_BUILT_CLI)('cli show e2e', () => {
  test('terminal mode emits header, version, redactions, recording sections', async () => {
    const r = await execa('node', [CLI, 'show', FIXTURE, '--no-color'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/^Cassette: /)
    expect(r.stdout).toContain('Version: 2')
    expect(r.stdout).toContain('Redactions:')
    expect(r.stdout).toContain('[1/1]')
    expect(r.stdout).toContain('gh auth status')
  })

  test('--json mode emits showVersion: 1 with summary and cassette', async () => {
    const r = await execa('node', [CLI, 'show', FIXTURE, '--json'])
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.showVersion).toBe(1)
    expect(parsed.summary.recordingCount).toBe(1)
    expect(parsed.cassette.recordings).toHaveLength(1)
  })

  test('exit 2 when path is missing', async () => {
    const r = await execa('node', [CLI, 'show'], { reject: false })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/show requires a path/)
  })
})
