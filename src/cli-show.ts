/**
 * `shell-cassette show` subcommand. Pretty-prints a single cassette for
 * human inspection. Read-only; does not modify cassettes.
 *
 * Two output modes:
 *   - terminal-formatted (default): sectioned (header + per-recording),
 *     TTY-aware color, truncation
 *   - --json: structured output, locked at showVersion: 1
 *
 * Terminal-mode section order: header, version, redactions summary, blank,
 * then per-recording (index/command/args, cwd, env (redacted keys only),
 * exit + duration, stdout, stderr, allLines when present, redaction count).
 *
 * Defaults: 5 lines per stream, 80 chars per line.
 */
import { stat } from 'node:fs/promises'
import { applyTruncation, color, formatBytes, isTty, stderr, stdout } from './cli-output.js'
import { CassetteConfigError, CassetteNotFoundError } from './errors.js'
import { loadCassette } from './loader.js'
import { REDACTION_PLACEHOLDER_PATTERN } from './redact-pipeline.js'
import type { CassetteFile, Recording } from './types.js'

const SHOW_VERSION = 1

const SHOW_HELP = `\
Usage:
  shell-cassette show <path> [options]

Pretty-prints a cassette for human inspection. Read-only.

Exit codes:
  0   ok
  2   error (missing path, malformed cassette, conflicting flags)

Options:
  --json              structured output (showVersion: 1)
  --full              disable truncation; show every line in full
  --lines <N>         lines per stream (default 5)
  --no-color
  --color=always
  --help
`

type ColorOverride = 'auto' | 'always' | 'never'

export type ShowFlags = {
  path: string | null
  json: boolean
  full: boolean
  lines: number
  colorOverride: ColorOverride
  help: boolean
}

export function parseShowArgs(args: readonly string[]): ShowFlags {
  const flags: ShowFlags = {
    path: null,
    json: false,
    full: false,
    lines: 5,
    colorOverride: 'auto',
    help: false,
  }
  for (let i = 0; i < args.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
    const arg = args[i]!
    if (arg === '--help' || arg === '-h') {
      flags.help = true
    } else if (arg === '--json') {
      flags.json = true
    } else if (arg === '--full') {
      flags.full = true
    } else if (arg === '--no-color') {
      flags.colorOverride = 'never'
    } else if (arg === '--color=always') {
      flags.colorOverride = 'always'
    } else if (arg === '--lines') {
      const next = args[++i]
      if (next === undefined) throw new CassetteConfigError('--lines requires a numeric argument')
      const n = Number.parseInt(next, 10)
      if (!Number.isInteger(n) || n < 0)
        throw new CassetteConfigError(`--lines must be a non-negative integer (got '${next}')`)
      flags.lines = n
    } else if (arg.startsWith('--lines=')) {
      const v = arg.slice('--lines='.length)
      const n = Number.parseInt(v, 10)
      if (!Number.isInteger(n) || n < 0)
        throw new CassetteConfigError(`--lines must be a non-negative integer (got '${v}')`)
      flags.lines = n
    } else if (arg.startsWith('--')) {
      throw new CassetteConfigError(`unknown flag: ${arg}`)
    } else {
      if (flags.path !== null) throw new CassetteConfigError('show takes exactly one path')
      flags.path = arg
    }
  }
  return flags
}

export type ShowSummary = {
  path: string
  fileSize: number
  version: CassetteFile['version']
  recordedBy: CassetteFile['recordedBy']
  recordingCount: number
  redactions: {
    total: number
    byRule: Record<string, number>
    bySource: Record<string, number>
  }
}

export function buildSummary(cassette: CassetteFile, path: string, fileSize: number): ShowSummary {
  const byRule: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  let total = 0
  for (const rec of cassette.recordings) {
    for (const entry of rec.redactions) {
      byRule[entry.rule] = (byRule[entry.rule] ?? 0) + entry.count
      bySource[entry.source] = (bySource[entry.source] ?? 0) + entry.count
      total += entry.count
    }
  }
  return {
    path,
    fileSize,
    version: cassette.version,
    recordedBy: cassette.recordedBy,
    recordingCount: cassette.recordings.length,
    redactions: { total, byRule, bySource },
  }
}

export async function runShow(args: readonly string[]): Promise<number> {
  let flags: ShowFlags
  try {
    flags = parseShowArgs(args)
  } catch (e) {
    stderr(`error: ${(e as Error).message}\n${SHOW_HELP}`)
    return 2
  }

  if (flags.help) {
    stdout(SHOW_HELP)
    return 0
  }
  if (flags.path === null) {
    stderr(`error: show requires a path\n${SHOW_HELP}`)
    return 2
  }

  color.setEnabled(
    isTty.shouldUseColor({ tty: isTty.detectStdoutTty(), override: flags.colorOverride }),
  )

  let cassette: CassetteFile
  let fileSize: number
  try {
    const loaded = await loadCassette(flags.path)
    if (loaded === null) throw new CassetteNotFoundError(flags.path)
    cassette = loaded
    const st = await stat(flags.path)
    fileSize = st.size
  } catch (e) {
    stderr(`error: ${(e as Error).message}`)
    return 2
  }

  const summary = buildSummary(cassette, flags.path, fileSize)
  if (flags.json) {
    stdout(JSON.stringify({ showVersion: SHOW_VERSION, summary, cassette }, null, 2))
  } else {
    printTerminal(cassette, summary, flags)
  }
  return 0
}

function printTerminal(cassette: CassetteFile, summary: ShowSummary, flags: ShowFlags): void {
  stdout(
    `${color.bold(`Cassette: ${summary.path}`)} (${summary.recordingCount} recordings, ${formatBytes(summary.fileSize)})`,
  )
  if (summary.recordedBy !== null) {
    stdout(
      `Version: ${summary.version} (recorded by ${summary.recordedBy.name}@${summary.recordedBy.version})`,
    )
  } else {
    stdout(`Version: ${summary.version} (recorder unknown)`)
  }
  if (summary.redactions.total > 0) {
    const byRuleList = Object.entries(summary.redactions.byRule)
      .map(([r, n]) => `${r}:${n}`)
      .join(', ')
    stdout(`Redactions: ${summary.redactions.total} total - ${byRuleList}`)
  } else if (summary.version === 1) {
    stdout(
      'Redactions: (none recorded; v1 cassette - run `shell-cassette re-redact` to capture them)',
    )
  } else {
    stdout('Redactions: 0')
  }
  stdout('')

  for (let i = 0; i < cassette.recordings.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
    printRecording(cassette.recordings[i]!, i, cassette.recordings.length, flags)
  }
}

function printRecording(rec: Recording, index: number, total: number, flags: ShowFlags): void {
  stdout(color.bold(`[${index + 1}/${total}] ${rec.call.command} ${rec.call.args.join(' ')}`))
  stdout(`  cwd: ${rec.call.cwd ?? '(null)'}`)

  const redactedEnvKeys = Object.entries(rec.call.env).filter(([, v]) =>
    REDACTION_PLACEHOLDER_PATTERN.test(v),
  )
  if (redactedEnvKeys.length > 0) {
    stdout('  env (redacted):')
    for (const [k, v] of redactedEnvKeys) {
      stdout(`    ${k}=${color.cyan(v)}`)
    }
  } else {
    stdout('  env: (none redacted)')
  }

  const exitColor = rec.result.exitCode === 0 ? color.green : color.red
  stdout(`  exit: ${exitColor(String(rec.result.exitCode))}  duration: ${rec.result.durationMs}ms`)

  printLines('stdout', rec.result.stdoutLines, flags)
  printLines('stderr', rec.result.stderrLines, flags)
  if (rec.result.allLines !== null) {
    printLines('allLines', rec.result.allLines, flags)
  }

  const redactionCount = rec.redactions.reduce((s, e) => s + e.count, 0)
  stdout(`  redactions: ${redactionCount}`)
  stdout('')
}

function printLines(name: string, lines: readonly string[], flags: ShowFlags): void {
  if (lines.length === 0) {
    stdout(`  ${name}: (empty)`)
    return
  }
  const limit = flags.full ? lines.length : flags.lines
  const shown = lines.slice(0, limit)
  stdout(`  ${name} (${lines.length} lines):`)
  for (const line of shown) {
    const truncated = flags.full ? line : applyTruncation(line, 80)
    stdout(`    ${highlightPlaceholders(truncated)}`)
  }
  if (lines.length > limit) {
    stdout(color.dim(`    ... (${lines.length - limit} more lines)`))
  }
}

function highlightPlaceholders(s: string): string {
  return s.replace(/<redacted:[^>]+>/g, (match) => color.cyan(match))
}
