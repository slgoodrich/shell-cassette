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
import { CassetteConfigError, CassetteInternalError } from './errors.js'
import type { CassetteFile } from './types.js'

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

// Stub: full implementation lives in a follow-up commit. Keeps the export
// shape stable so dispatch wire-up can land in its own commit.
export async function runShow(_args: readonly string[]): Promise<number> {
  throw new CassetteInternalError('runShow not yet implemented')
}
