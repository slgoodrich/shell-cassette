import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runReRedact } from '../../src/cli-re-redact.js'
import { SAMPLE_GITHUB_PAT_CLASSIC } from '../helpers/credential-fixtures.js'
import { restoreEnv } from '../helpers/env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const FIXTURES = path.resolve('tests/fixtures/cassettes')

const originalNoColor = process.env.NO_COLOR

const tmpDir = useTmpDir('shell-cassette-rr-')
let stdoutSpy: ReturnType<typeof vi.spyOn>
let stderrSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Pin NO_COLOR so terminal output is predictable in tests (no ANSI codes)
  process.env.NO_COLOR = '1'
})
afterEach(() => {
  stdoutSpy?.mockRestore()
  stderrSpy?.mockRestore()
  restoreEnv('NO_COLOR', originalNoColor)
})

function captureOutput() {
  let stdoutBuf = ''
  let stderrBuf = ''
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutBuf += chunk?.toString() ?? ''
    return true
  })
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrBuf += chunk?.toString() ?? ''
    return true
  })
  return {
    get stdout() {
      return stdoutBuf
    },
    get stderr() {
      return stderrBuf
    },
  }
}

describe('runReRedact: idempotence', () => {
  test('running twice yields no changes the second time', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await copyFile(path.join(FIXTURES, 'v2-dirty.json'), target)

    captureOutput()
    const first = await runReRedact([target, '--no-color'])
    expect(first).toBe(1)

    const second = await runReRedact([target, '--no-color'])
    expect(second).toBe(0)
  })
})

describe('runReRedact: keep-existing', () => {
  test('pre-existing placeholders are unchanged after re-redact', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    const cassette = {
      version: 2,
      _warning: 'REVIEW',
      _recorded_by: { name: 'shell-cassette', version: '0.4.0' },
      recordings: [
        {
          call: {
            command: 'curl',
            args: ['<redacted:args:github-pat-classic:1>'],
            cwd: null,
            env: {},
            stdin: null,
          },
          result: {
            stdoutLines: [],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 100,
            aborted: false,
          },
          _redactions: [{ rule: 'github-pat-classic', source: 'args', count: 1 }],
        },
      ],
    }
    await writeFile(target, `${JSON.stringify(cassette, null, 2)}\n`)

    captureOutput()
    const code = await runReRedact([target, '--no-color'])
    expect(code).toBe(0)

    const after = JSON.parse(await readFile(target, 'utf8'))
    expect(after.recordings[0].call.args[0]).toBe('<redacted:args:github-pat-classic:1>')
  })
})

describe('runReRedact: counter max+1', () => {
  test('new finding starts at max+1 per (source, rule)', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    // Cassette already has :1 in env for github-pat-classic. Add a new dirty arg.
    const cassette = {
      version: 2,
      _warning: 'REVIEW',
      _recorded_by: { name: 'shell-cassette', version: '0.4.0' },
      recordings: [
        {
          call: {
            command: 'curl',
            args: [`Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`],
            cwd: null,
            env: { OLD: '<redacted:env:github-pat-classic:1>' },
            stdin: null,
          },
          result: {
            stdoutLines: [],
            stderrLines: [],
            allLines: null,
            exitCode: 0,
            signal: null,
            durationMs: 100,
            aborted: false,
          },
          _redactions: [{ rule: 'github-pat-classic', source: 'env', count: 1 }],
        },
      ],
    }
    await writeFile(target, `${JSON.stringify(cassette, null, 2)}\n`)

    captureOutput()
    const code = await runReRedact([target, '--no-color'])
    expect(code).toBe(1)

    const after = JSON.parse(await readFile(target, 'utf8'))
    // args counter starts at 1 (separate (args, github-pat-classic) key)
    expect(after.recordings[0].call.args[0]).toBe('Bearer <redacted:args:github-pat-classic:1>')
    // env counter unchanged
    expect(after.recordings[0].call.env.OLD).toBe('<redacted:env:github-pat-classic:1>')
  })
})

describe('runReRedact: v1 upgrade', () => {
  test('v1 cassette is upgraded to v2 in place', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    const v1 = {
      version: 1,
      recordings: [
        {
          call: {
            command: 'curl',
            args: [`Bearer ${SAMPLE_GITHUB_PAT_CLASSIC}`],
            cwd: null,
            env: {},
            stdin: null,
          },
          result: {
            stdoutLines: [],
            stderrLines: [],
            exitCode: 0,
            signal: null,
            durationMs: 100,
          },
        },
      ],
    }
    await writeFile(target, `${JSON.stringify(v1, null, 2)}\n`)

    captureOutput()
    const code = await runReRedact([target, '--no-color'])
    expect(code).toBe(1)

    const after = JSON.parse(await readFile(target, 'utf8'))
    expect(after.version).toBe(2)
    expect(after._recorded_by).toBeDefined()
    expect(after._recorded_by.name).toBe('shell-cassette')
    expect(after.recordings[0].call.args[0]).toBe('Bearer <redacted:args:github-pat-classic:1>')
    expect(after.recordings[0]._redactions).toEqual([
      { rule: 'github-pat-classic', source: 'args', count: 1 },
    ])
  })
})

describe('runReRedact: --dry-run', () => {
  test('--dry-run does not write the cassette', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await copyFile(path.join(FIXTURES, 'v2-dirty.json'), target)
    const before = await readFile(target, 'utf8')

    captureOutput()
    const code = await runReRedact([target, '--dry-run', '--no-color'])
    expect(code).toBe(1)

    const after = await readFile(target, 'utf8')
    expect(after).toBe(before)
  })
})

describe('runReRedact: error paths', () => {
  test('non-existent path: exit 2', async () => {
    const out = captureOutput()
    const code = await runReRedact(['/nonexistent/path.json', '--no-color'])
    expect(code).toBe(2)
    expect(out.stderr).toContain('error')
  })

  test('unknown flag: exit 2', async () => {
    const out = captureOutput()
    const code = await runReRedact(['--unknown-flag'])
    expect(code).toBe(2)
    expect(out.stderr).toContain('unknown flag')
  })

  test('no path arg: exit 2 with help', async () => {
    const out = captureOutput()
    const code = await runReRedact([])
    expect(code).toBe(2)
    expect(out.stderr).toContain('requires at least one path')
  })
})

describe('runReRedact: --quiet', () => {
  test('--quiet suppresses all stdout output', async () => {
    const target = path.join(tmpDir.ref(), 'foo.json')
    await copyFile(path.join(FIXTURES, 'v2-clean.json'), target)

    const out = captureOutput()
    const code = await runReRedact([target, '--quiet'])
    expect(code).toBe(0)
    expect(out.stdout).toBe('')
  })
})

describe('runReRedact: --config <path>', () => {
  test('--config <path> loads explicit config and custom rules apply', async () => {
    const target = path.join(tmpDir.ref(), 'cassette.json')
    const configPath = path.join(tmpDir.ref(), 'shell-cassette.config.mjs')
    // Custom config: disable bundled patterns, add a custom rule that redacts 'hunter2'
    await writeFile(
      configPath,
      `export default {
  redact: {
    bundledPatterns: false,
    customPatterns: [{ name: 'custom-secret', pattern: /hunter2/g }],
  }
}`,
      'utf8',
    )
    // Cassette with a value that only the custom rule would catch
    await writeFile(
      target,
      JSON.stringify({
        version: 2,
        _recorded_by: { name: 'shell-cassette', version: '0.4.0' },
        recordings: [
          {
            call: {
              command: 'echo',
              args: ['hunter2'],
              cwd: null,
              env: {},
              stdin: null,
            },
            result: {
              stdoutLines: [],
              stderrLines: [],
              allLines: null,
              exitCode: 0,
              signal: null,
              durationMs: 0,
              aborted: false,
            },
            _redactions: [],
          },
        ],
      }),
      'utf8',
    )

    captureOutput()
    const code = await runReRedact([target, '--config', configPath, '--no-color'])
    expect(code).toBe(1)

    const after = JSON.parse(await readFile(target, 'utf8'))
    expect(after.recordings[0].call.args[0]).toBe('<redacted:args:custom-secret:1>')
  })
})
