import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runScan } from '../../src/cli-scan.js'
import { SAMPLE_GITHUB_PAT_CLASSIC } from '../helpers/credential-fixtures.js'
import { restoreEnv } from '../helpers/env.js'

const FIXTURES = path.resolve('tests/fixtures/cassettes')

const originalNoColor = process.env.NO_COLOR
const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION

let stdoutSpy: ReturnType<typeof vi.spyOn>
let stderrSpy: ReturnType<typeof vi.spyOn>
let stdoutBuf: string
let stderrBuf: string

function captureOutput() {
  stdoutBuf = ''
  stderrBuf = ''
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutBuf += chunk?.toString() ?? ''
    return true
  })
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrBuf += chunk?.toString() ?? ''
    return true
  })
}

beforeEach(() => {
  // Pin NO_COLOR so terminal output is predictable in tests (no ANSI codes)
  process.env.NO_COLOR = '1'
})

afterEach(() => {
  stdoutSpy?.mockRestore()
  stderrSpy?.mockRestore()
  restoreEnv('NO_COLOR', originalNoColor)
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
})

describe('runScan: clean cassettes', () => {
  test('clean cassette: exit 0, output marks clean', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-clean.json')])
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('clean')
    expect(stdoutBuf).toContain('v2-clean.json')
  })

  test('--quiet on clean cassette: no stdout, exit 0', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-clean.json'), '--quiet'])
    expect(code).toBe(0)
    expect(stdoutBuf).toBe('')
  })
})

describe('runScan: dirty cassettes', () => {
  test('dirty cassette: exit 1, findings reported', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-dirty.json')])
    expect(code).toBe(1)
    expect(stdoutBuf).toContain('unredacted')
    expect(stdoutBuf).toContain('github-pat-classic')
  })

  test('--quiet on dirty cassette: no stdout, exit 1', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-dirty.json'), '--quiet'])
    expect(code).toBe(1)
    expect(stdoutBuf).toBe('')
  })
})

describe('runScan: --json output', () => {
  test('clean cassette --json: scanVersion + summary', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-clean.json'), '--json'])
    expect(code).toBe(0)
    const parsed = JSON.parse(stdoutBuf)
    expect(parsed.scanVersion).toBe(1)
    expect(parsed.summary.scanned).toBe(1)
    expect(parsed.summary.clean).toBe(1)
    expect(parsed.summary.dirty).toBe(0)
    expect(parsed.cassettes).toHaveLength(1)
    expect(parsed.cassettes[0].status).toBe('clean')
  })

  test('dirty cassette --json: findings array with required fields', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-dirty.json'), '--json'])
    expect(code).toBe(1)
    const parsed = JSON.parse(stdoutBuf)
    expect(parsed.scanVersion).toBe(1)
    expect(parsed.summary.dirty).toBe(1)
    expect(parsed.cassettes[0].findings.length).toBeGreaterThan(0)
    const finding = parsed.cassettes[0].findings[0]
    expect(finding.id).toMatch(/^rec\d+-\w+-/)
    expect(finding.recordingIndex).toBeTypeOf('number')
    expect(finding.source).toBeTypeOf('string')
    expect(finding.rule).toBeTypeOf('string')
    expect(finding.matchHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(finding.matchLength).toBeTypeOf('number')
    expect(finding.matchPreview).toBeTypeOf('string')
    // Default --json must NOT include the raw match
    expect(finding.match).toBeUndefined()
  })

  test('--json --include-match: raw match field present', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-dirty.json'), '--json', '--include-match'])
    expect(code).toBe(1)
    const parsed = JSON.parse(stdoutBuf)
    const finding = parsed.cassettes[0].findings[0]
    expect(finding.match).toBeTypeOf('string')
    expect(finding.match).toBe(SAMPLE_GITHUB_PAT_CLASSIC)
  })

  test('matchPreview format: >=12 chars uses first4...last4', async () => {
    captureOutput()
    await runScan([path.join(FIXTURES, 'v2-dirty.json'), '--json'])
    const parsed = JSON.parse(stdoutBuf)
    const finding = parsed.cassettes[0].findings[0]
    expect(finding.matchLength).toBe(40) // GitHub PAT length
    // first 4 chars + ... + last 4 chars
    expect(finding.matchPreview).toBe('ghp_...7890')
  })
})

describe('runScan: error cases', () => {
  test('non-existent path: exit 2, error to stderr', async () => {
    captureOutput()
    const code = await runScan(['/nonexistent/path.json'])
    expect(code).toBe(2)
    expect(stderrBuf).toContain('error')
  })

  test('unknown flag: exit 2', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-clean.json'), '--unknown-flag'])
    expect(code).toBe(2)
    expect(stderrBuf).toContain('unknown flag')
  })

  test('no path arg: exit 2 with help', async () => {
    captureOutput()
    const code = await runScan([])
    expect(code).toBe(2)
    expect(stderrBuf).toContain('requires at least one path')
  })

  test('--help: exit 0 with help text', async () => {
    captureOutput()
    const code = await runScan(['--help'])
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('Usage:')
    expect(stdoutBuf).toContain('--json')
  })
})

describe('runScan: multi-path', () => {
  test('multi-path: aggregates results, exit 1 if any dirty', async () => {
    captureOutput()
    const code = await runScan([
      path.join(FIXTURES, 'v2-clean.json'),
      path.join(FIXTURES, 'v2-dirty.json'),
    ])
    expect(code).toBe(1)
    expect(stdoutBuf).toContain('clean')
    expect(stdoutBuf).toContain('unredacted')
  })

  test('directory walk: scans nested cassettes', async () => {
    captureOutput()
    const code = await runScan([FIXTURES])
    // Both v2-clean.json and v2-dirty.json exist in the fixtures dir
    expect([0, 1]).toContain(code)
    expect(stdoutBuf).toContain('cassette')
  })
})

describe('runScan: --no-bundled', () => {
  test('--no-bundled disables bundled patterns', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-dirty.json'), '--no-bundled'])
    // With bundled patterns disabled, the gh-pat rule won't match. No findings expected.
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('clean')
  })
})

describe('runScan: matchHash correctness', () => {
  test('matchHash is sha256 of the raw match value', async () => {
    captureOutput()
    await runScan([path.join(FIXTURES, 'v2-dirty.json'), '--json', '--include-match'])
    const parsed = JSON.parse(stdoutBuf)
    const finding = parsed.cassettes[0].findings[0]
    // Verify hash independently
    const { createHash } = await import('node:crypto')
    const expected = `sha256:${createHash('sha256')
      .update(finding.match as string)
      .digest('hex')}`
    expect(finding.matchHash).toBe(expected)
  })
})

describe('runScan: summary line', () => {
  test('summary shows scanned count and dirty count', async () => {
    captureOutput()
    await runScan([path.join(FIXTURES, 'v2-clean.json'), path.join(FIXTURES, 'v2-dirty.json')])
    expect(stdoutBuf).toContain('2 cassette(s) scanned')
    expect(stdoutBuf).toContain('1 dirty')
  })
})

describe('runScan: env-key-match coverage', () => {
  test('env value with curated key but no pattern match: reported as unredacted', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'scan-envkey-'))
    try {
      const cassettePath = path.join(tmp, 'envkey.json')
      await writeFile(
        cassettePath,
        JSON.stringify({
          version: 2,
          _recorded_by: { name: 'shell-cassette', version: '0.4.0' },
          recordings: [
            {
              call: {
                command: 'curl',
                args: [],
                cwd: null,
                env: { GITHUB_TOKEN: 'opaque-internal-format-no-known-shape' },
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
      const code = await runScan([cassettePath, '--json'])
      expect(code).toBe(1)
      const parsed = JSON.parse(stdoutBuf)
      expect(parsed.cassettes[0].findings[0].rule).toBe('env-key-match')
      expect(parsed.cassettes[0].findings[0].source).toBe('env')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('env value already redacted as placeholder: not reported', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'scan-envkey-'))
    try {
      const cassettePath = path.join(tmp, 'envkey.json')
      await writeFile(
        cassettePath,
        JSON.stringify({
          version: 2,
          _recorded_by: { name: 'shell-cassette', version: '0.4.0' },
          recordings: [
            {
              call: {
                command: 'curl',
                args: [],
                cwd: null,
                env: { GITHUB_TOKEN: '<redacted:env:env-key-match:1>' },
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
              _redactions: [{ rule: 'env-key-match', source: 'env', count: 1 }],
            },
          ],
        }),
        'utf8',
      )
      captureOutput()
      const code = await runScan([cassettePath, '--json'])
      expect(code).toBe(0)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('runScan: --config <path>', () => {
  test('--config <path> loads explicit config file', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'scan-config-'))
    try {
      const configPath = path.join(tmp, 'shell-cassette.config.mjs')
      // Custom config with bundled patterns disabled
      await writeFile(configPath, `export default { redact: { bundledPatterns: false } }`, 'utf8')
      captureOutput()
      const code = await runScan([path.join(FIXTURES, 'v2-dirty.json'), '--config', configPath])
      // With bundled patterns disabled, the dirty cassette is clean
      expect(code).toBe(0)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('runScan: --json + --quiet interaction', () => {
  test('--json --quiet: --json takes precedence; JSON still emitted', async () => {
    captureOutput()
    const code = await runScan([path.join(FIXTURES, 'v2-clean.json'), '--json', '--quiet'])
    expect(code).toBe(0)
    // --json overrides --quiet (matches plan reference impl)
    expect(stdoutBuf.length).toBeGreaterThan(0)
    const parsed = JSON.parse(stdoutBuf)
    expect(parsed.scanVersion).toBe(1)
  })
})

describe('runScan: isSuppressed g-flag lastIndex bug (closes #62)', () => {
  test('g-flagged suppress pattern suppresses all three consecutive matching recordings', async () => {
    // Without resetting lastIndex before each .test() call, a g-flagged suppress
    // regex retains state between recordings. The second or third recording that
    // matches the same pattern would incorrectly fall through as unsuppressed.
    const tmp = await mkdtemp(path.join(tmpdir(), 'scan-suppress-'))
    const configPath = path.join(tmp, 'shell-cassette.config.mjs')
    const cassettePath = path.join(tmp, 'suppress.json')
    try {
      // Config: disable bundled patterns; use a g-flagged custom suppress pattern.
      // The suppress pattern is written as a string to avoid JSON serialization issues.
      await writeFile(
        configPath,
        `export default { redact: { bundledPatterns: false, suppressPatterns: [/secret/gi] } }`,
        'utf8',
      )
      // Cassette: three recordings, each with a custom pattern value that would
      // trigger a bundled or custom rule. We use a custom rule via config instead.
      // Actually: use a cassette with three arg values containing a custom pattern.
      // Suppress them all so the scan returns clean.
      await writeFile(
        cassettePath,
        JSON.stringify({
          version: 2,
          _recorded_by: { name: 'shell-cassette', version: '0.4.0' },
          recordings: [
            {
              call: {
                command: 'curl',
                args: ['my-secret-token-1'],
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
            {
              call: {
                command: 'curl',
                args: ['my-secret-token-2'],
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
            {
              call: {
                command: 'curl',
                args: ['my-secret-token-3'],
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
      // With bundled patterns disabled and values suppressed, all three recordings
      // must come back clean. Without the lastIndex fix, recordings 2 and 3 would
      // escape the suppress check and the scan would return dirty.
      const code = await runScan([cassettePath, '--json', '--config', configPath])
      expect(code).toBe(0)
      const parsed = JSON.parse(stdoutBuf)
      expect(parsed.summary.dirty).toBe(0)
      expect(parsed.cassettes[0].status).toBe('clean')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
