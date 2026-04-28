import { stat } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { beforeAll, describe, expect, test } from 'vitest'

const CLI_BIN = path.resolve('dist/cli.js')
const FIXTURES = path.resolve('tests/fixtures/cassettes')

beforeAll(async () => {
  try {
    await stat(CLI_BIN)
  } catch {
    throw new Error(`dist/cli.js missing: run \`npm run build\` before e2e tests`)
  }
})

describe('shell-cassette binary (e2e)', () => {
  test('--version prints package version', async () => {
    const result = await execa('node', [CLI_BIN, '--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('--help prints usage', async () => {
    const result = await execa('node', [CLI_BIN, '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('scan')
    expect(result.stdout).toContain('re-redact')
  })

  test('scan on clean cassette: exit 0', async () => {
    const result = await execa('node', [
      CLI_BIN,
      'scan',
      path.join(FIXTURES, 'v2-clean.json'),
      '--no-color',
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('clean')
  })

  test('scan on dirty cassette: exit 1', async () => {
    const result = await execa(
      'node',
      [CLI_BIN, 'scan', path.join(FIXTURES, 'v2-dirty.json'), '--no-color'],
      { reject: false },
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('unredacted')
  })

  test('scan --json valid JSON output', async () => {
    const result = await execa(
      'node',
      [CLI_BIN, 'scan', path.join(FIXTURES, 'v2-dirty.json'), '--json'],
      { reject: false },
    )
    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.scanVersion).toBe(1)
  })

  test('unknown command: exit 2', async () => {
    const result = await execa('node', [CLI_BIN, 'frobnicate'], { reject: false })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('unknown command')
  })
})
