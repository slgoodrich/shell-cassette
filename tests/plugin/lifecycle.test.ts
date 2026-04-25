import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { execa as childExeca } from 'execa'
import { describe, expect, test } from 'vitest'

describe('vitest plugin lifecycle (subprocess-driven)', () => {
  test('plugin records cassettes for tests in fixture project', async () => {
    const fixtureDir = path.resolve('tests/plugin/fixtures/basic')

    // Run vitest in the fixture dir
    await childExeca('npx', ['vitest', 'run'], {
      cwd: fixtureDir,
      env: {
        ...process.env,
        SHELL_CASSETTE_ACK_REDACTION: 'true',
      },
      reject: false,
    })

    // Check that cassette file was written
    const cassetteFile = path.join(
      fixtureDir,
      'src',
      '__cassettes__',
      'sample.test.ts',
      'records-node-version.json',
    )
    const content = await readFile(cassetteFile, 'utf8')
    expect(content).toContain('node')

    // Cleanup the test artifacts
    await rm(path.join(fixtureDir, 'src', '__cassettes__'), {
      recursive: true,
      force: true,
    })
  }, 60000) // 60s timeout — vitest subprocess startup is slow on Windows
})
