/**
 * `shell-cassette scan` subcommand. Walks cassette files (or directories)
 * and reports any unredacted findings — credentials that record mode would
 * have redacted but are present in cassette content (env values, args,
 * stdout/stderr/allLines).
 *
 * Two coverage paths:
 *   1. env-key-match: env value with a key in the curated or user envKeys
 *      list. Whole value is reported regardless of pattern.
 *   2. pattern match: bundled or custom regex rules. Position-precise via
 *      String.prototype.matchAll.
 *
 * Function-typed custom rules are skipped (can't report exact positions).
 *
 * Output format is locked at scanVersion: 1. See spec Section 4 for the
 * complete --json shape.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { color, isTty, stderr, stdout } from './cli-output.js'
import { walkCassettes } from './cli-walk.js'
import { loadConfigFromDir, loadConfigFromFile } from './config.js'
import { CassetteConfigError } from './errors.js'
import { matchesEnvKeyList } from './recorder.js'
import { BUNDLED_PATTERNS } from './redact-patterns.js'
import { ENV_KEY_MATCH_RULE } from './redact-pipeline.js'
import { deserialize } from './serialize.js'
import type { CassetteFile, Recording, RedactConfig, RedactSource } from './types.js'

const SCAN_VERSION = 1

const SCAN_HELP = `\
Usage:
  shell-cassette scan [paths...] [options]

Walks cassette files (or directories of them) and reports any unredacted
findings. Read-only; does not modify cassettes.

Exit codes:
  0   all cassettes clean
  1   at least one cassette has findings
  2   error (missing path, malformed cassette, conflicting flags)

Options:
  --json              structured output
  --quiet             suppress stdout (exit code only)
  --include-match     [with --json] include raw match values (UNSAFE for piping)
  --config <path>     override config discovery
  --no-bundled        skip bundled patterns; user rules + suppress only
  --no-color
  --color=always
  --help
`

type Finding = {
  id: string
  recordingIndex: number
  source: RedactSource
  rule: string
  match?: string // only set with --include-match
  matchHash: string
  matchLength: number
  matchPreview: string
}

type CassetteResult = {
  path: string
  status: 'clean' | 'dirty' | 'error'
  findings?: Finding[]
  error?: string
  redactionsApplied: number
}

type ColorOverride = 'auto' | 'always' | 'never'

type ScanFlags = {
  paths: string[]
  json: boolean
  quiet: boolean
  includeMatch: boolean
  configPath?: string
  noBundled: boolean
  colorOverride: ColorOverride
  help: boolean
}

function parseScanArgs(args: readonly string[]): ScanFlags {
  const flags: ScanFlags = {
    paths: [],
    json: false,
    quiet: false,
    includeMatch: false,
    noBundled: false,
    colorOverride: 'auto',
    help: false,
  }
  for (let i = 0; i < args.length; i++) {
    // args[i] is always defined here since i < args.length
    // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
    const arg = args[i]!
    if (arg === '--help' || arg === '-h') {
      flags.help = true
    } else if (arg === '--json') {
      flags.json = true
    } else if (arg === '--quiet') {
      flags.quiet = true
    } else if (arg === '--include-match') {
      flags.includeMatch = true
    } else if (arg === '--no-bundled') {
      flags.noBundled = true
    } else if (arg === '--no-color') {
      flags.colorOverride = 'never'
    } else if (arg === '--color=always') {
      flags.colorOverride = 'always'
    } else if (arg === '--config') {
      const next = args[++i]
      if (next === undefined) throw new CassetteConfigError('--config requires a path argument')
      flags.configPath = next
    } else if (arg.startsWith('--config=')) {
      flags.configPath = arg.slice('--config='.length)
    } else if (arg.startsWith('--')) {
      throw new CassetteConfigError(`unknown flag: ${arg}`)
    } else {
      flags.paths.push(arg)
    }
  }
  return flags
}

/**
 * Scan one or more cassette files or directories for unredacted credentials.
 * Returns 0 if all clean, 1 if any dirty, 2 on error.
 */
export async function runScan(args: readonly string[]): Promise<number> {
  let flags: ScanFlags
  try {
    flags = parseScanArgs(args)
  } catch (e) {
    stderr(`error: ${(e as Error).message}\n${SCAN_HELP}`)
    return 2
  }

  if (flags.help) {
    stdout(SCAN_HELP)
    return 0
  }

  if (flags.paths.length === 0) {
    stderr(`error: scan requires at least one path\n${SCAN_HELP}`)
    return 2
  }

  color.setEnabled(
    isTty.shouldUseColor({ tty: isTty.detectStdoutTty(), override: flags.colorOverride }),
  )

  const config = flags.configPath
    ? await loadConfigFromFile(flags.configPath)
    : await loadConfigFromDir(process.cwd())
  const effectiveRedact: Readonly<RedactConfig> = flags.noBundled
    ? Object.freeze({ ...config.redact, bundledPatterns: false })
    : config.redact

  let cassettePaths: string[]
  try {
    cassettePaths = await walkCassettes(flags.paths)
  } catch (e) {
    stderr(`error: ${(e as Error).message}`)
    return 2
  }

  const results: CassetteResult[] = []
  for (const p of cassettePaths) {
    results.push(await scanOne(p, effectiveRedact, flags.includeMatch))
  }

  if (flags.json) {
    stdout(JSON.stringify(buildJsonOutput(results), null, 2))
  } else if (!flags.quiet) {
    printHumanOutput(results)
  }

  const errors = results.filter((r) => r.status === 'error').length
  const dirty = results.filter((r) => r.status === 'dirty').length
  if (errors > 0) return 2
  if (dirty > 0) return 1
  return 0
}

async function scanOne(
  filePath: string,
  config: Readonly<RedactConfig>,
  includeMatch: boolean,
): Promise<CassetteResult> {
  let cassette: CassetteFile
  try {
    const text = await readFile(filePath, 'utf8')
    cassette = deserialize(text)
  } catch (e) {
    return { path: filePath, status: 'error', error: (e as Error).message, redactionsApplied: 0 }
  }

  const findings: Finding[] = []
  for (const [i, rec] of cassette.recordings.entries()) {
    findings.push(...findingsForRecording(rec, i, config, includeMatch))
  }

  const redactionsApplied = cassette.recordings.reduce(
    (sum, r) => sum + r.redactions.reduce((s, e) => s + e.count, 0),
    0,
  )

  return {
    path: filePath,
    status: findings.length > 0 ? 'dirty' : 'clean',
    findings: findings.length > 0 ? findings : undefined,
    redactionsApplied,
  }
}

/**
 * Build g-flagged regex copies of bundled + custom rules for matchAll usage.
 * Built once per recording (not per-value) to amortize the allocation cost.
 * Function-typed custom rules are skipped — they can't report match positions.
 */
function buildGFlaggedRules(
  config: Readonly<RedactConfig>,
): readonly { name: string; pattern: RegExp }[] {
  const rules: { name: string; pattern: RegExp }[] = []

  if (config.bundledPatterns) {
    for (const rule of BUNDLED_PATTERNS) {
      if (rule.pattern instanceof RegExp) {
        const flags = rule.pattern.flags.includes('g')
          ? rule.pattern.flags
          : `${rule.pattern.flags}g`
        rules.push({ name: rule.name, pattern: new RegExp(rule.pattern.source, flags) })
      }
    }
  }

  for (const rule of config.customPatterns) {
    if (rule.pattern instanceof RegExp) {
      const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`
      rules.push({ name: rule.name, pattern: new RegExp(rule.pattern.source, flags) })
    }
    // Function-typed custom patterns: not scannable by position; skip for scan.
  }

  return rules
}

function isSuppressed(value: string, config: Readonly<RedactConfig>): boolean {
  for (const sup of config.suppressPatterns) {
    if (sup.test(value)) return true
  }
  return false
}

/** Returns true if value is already a redaction placeholder (counter-tagged or counter-stripped). */
function isPlaceholder(value: string): boolean {
  return /^<redacted:[^:>]+:[^:>]+(:\d+)?>$/.test(value)
}

/**
 * Iterate all 5 sources in a recording (env, args, stdout, stderr, allLines)
 * and produce a list of unredacted Finding objects. Each finding includes
 * source-specific position info embedded in its id.
 */
function findingsForRecording(
  rec: Recording,
  index: number,
  config: Readonly<RedactConfig>,
  includeMatch: boolean,
): Finding[] {
  const rules = buildGFlaggedRules(config)
  const findings: Finding[] = []

  // env: env-key-match check first, then pattern scan on non-matching keys
  for (const [key, value] of Object.entries(rec.call.env)) {
    // env-key-match: if the key matches the curated/user envKeys list, the
    // recorder would have redacted the whole value regardless of pattern.
    // Scan must report this so cassettes that would have been redacted by
    // record mode aren't falsely reported as clean.
    if (matchesEnvKeyList(key, config.envKeys) && !isPlaceholder(value)) {
      findings.push({
        id: `rec${index}-env-${key}:0-${ENV_KEY_MATCH_RULE}`,
        recordingIndex: index,
        source: 'env',
        rule: ENV_KEY_MATCH_RULE,
        match: includeMatch ? value : undefined,
        matchHash: `sha256:${createHash('sha256').update(value).digest('hex')}`,
        matchLength: value.length,
        matchPreview: previewMatch(value),
      })
      continue // don't also pattern-scan; whole value is already sensitive
    }
    findings.push(...scanValue(value, 'env', key, index, rules, config, includeMatch))
  }

  // args: scan each arg, use arg index as position label
  for (const [argIdx, arg] of rec.call.args.entries()) {
    findings.push(...scanValue(arg, 'args', argIdx.toString(), index, rules, config, includeMatch))
  }

  // stdout lines: use 1-based line number as position label
  for (const [lineIdx, line] of rec.result.stdoutLines.entries()) {
    findings.push(
      ...scanValue(line, 'stdout', (lineIdx + 1).toString(), index, rules, config, includeMatch),
    )
  }

  // stderr lines
  for (const [lineIdx, line] of rec.result.stderrLines.entries()) {
    findings.push(
      ...scanValue(line, 'stderr', (lineIdx + 1).toString(), index, rules, config, includeMatch),
    )
  }

  // allLines (only when present)
  if (rec.result.allLines !== null) {
    for (const [lineIdx, line] of rec.result.allLines.entries()) {
      findings.push(
        ...scanValue(
          line,
          'allLines',
          (lineIdx + 1).toString(),
          index,
          rules,
          config,
          includeMatch,
        ),
      )
    }
  }

  return findings
}

function scanValue(
  value: string,
  source: RedactSource,
  positionLabel: string,
  recordingIndex: number,
  rules: readonly { name: string; pattern: RegExp }[],
  config: Readonly<RedactConfig>,
  includeMatch: boolean,
): Finding[] {
  if (isSuppressed(value, config)) return []

  const findings: Finding[] = []

  for (const rule of rules) {
    // Reset lastIndex before each matchAll (g-flag regexes are stateful)
    rule.pattern.lastIndex = 0
    for (const m of value.matchAll(rule.pattern)) {
      const matchStr = m[0]
      const col = m.index ?? 0
      const position = `${positionLabel}:${col}`
      const id = `rec${recordingIndex}-${source}-${position}-${rule.name}`
      findings.push({
        id,
        recordingIndex,
        source,
        rule: rule.name,
        match: includeMatch ? matchStr : undefined,
        matchHash: `sha256:${createHash('sha256').update(matchStr).digest('hex')}`,
        matchLength: matchStr.length,
        matchPreview: previewMatch(matchStr),
      })
    }
  }

  return findings
}

function previewMatch(s: string): string {
  if (s.length < 12) return s
  return `${s.slice(0, 4)}...${s.slice(-4)}`
}

function buildJsonOutput(results: readonly CassetteResult[]): unknown {
  const summary = {
    scanned: results.length,
    clean: results.filter((r) => r.status === 'clean').length,
    dirty: results.filter((r) => r.status === 'dirty').length,
    errors: results.filter((r) => r.status === 'error').length,
    totalFindings: results.reduce((s, r) => s + (r.findings?.length ?? 0), 0),
  }
  // Build cassette entries in the locked JSON API shape
  const cassettes = results.map((r) => {
    if (r.status === 'error') {
      return { path: r.path, status: r.status, error: r.error, redactionsApplied: 0 }
    }
    if (r.status === 'dirty') {
      return {
        path: r.path,
        status: r.status,
        redactionsApplied: r.redactionsApplied,
        findings: r.findings,
      }
    }
    return { path: r.path, status: r.status, redactionsApplied: r.redactionsApplied }
  })
  return { scanVersion: SCAN_VERSION, summary, cassettes }
}

function printHumanOutput(results: readonly CassetteResult[]): void {
  for (const r of results) {
    if (r.status === 'clean') {
      stdout(
        `${r.path}: ${color.green('clean')} (${r.redactionsApplied} redaction(s) already applied)`,
      )
    } else if (r.status === 'error') {
      stdout(`${r.path}: ${color.red('error')} - ${r.error}`)
    } else {
      stdout(`${r.path}: ${color.yellow(`${r.findings?.length} unredacted finding(s)`)}`)
      for (const f of r.findings ?? []) {
        stdout(`  [${f.id}]: ${color.cyan(f.matchPreview)} (${f.matchLength} chars)`)
      }
    }
  }
  const dirty = results.filter((r) => r.status === 'dirty').length
  const errors = results.filter((r) => r.status === 'error').length
  stdout('')
  stdout(`${results.length} cassette(s) scanned, ${dirty} dirty, ${errors} error(s).`)
}
