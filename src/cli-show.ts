/**
 * `shell-cassette show` subcommand. Pretty-prints a single cassette for
 * human inspection. Read-only; does not modify cassettes.
 *
 * Two output modes:
 *   - terminal-formatted (default): sectioned (header + per-recording),
 *     TTY-aware color, truncation
 *   - --json: structured output, locked at showVersion: 1
 *
 * Section order in terminal mode (LOCKED, API):
 *   1. Header (path + size)
 *   2. Version line
 *   3. Redactions summary line
 *   4. Blank line
 *   5. Per-recording in cassette order:
 *      a. Index + command + args
 *      b. cwd
 *      c. env (only redacted keys)
 *      d. exit + duration
 *      e. stdout (with truncation)
 *      f. stderr (with truncation)
 *      g. allLines (when present, with truncation)
 *      h. redaction count
 *
 * Defaults: 5 lines per stream, 80 chars per line. Subject to major-version
 * review (documented as such).
 */
import { CassetteConfigError, ShellCassetteError } from './errors.js'
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
  version: 1 | 2
  recordedBy: { name: string; version: string } | null
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

// Real implementation lands in the next commit. The stub keeps the
// module's export shape stable across the three commits that build
// out the show subcommand (helpers -> renderers -> dispatch wire-up).
export async function runShow(_args: readonly string[]): Promise<number> {
  throw new ShellCassetteError('runShow not yet implemented (internal bug; should be unreachable)')
}
