/**
 * `shell-cassette re-redact` subcommand. Re-applies the current redaction
 * rules to existing cassettes. Idempotent: running twice yields identical
 * output. Use this when the bundled pattern set expands or when a user adds
 * a custom rule and wants to upgrade existing cassettes.
 *
 * Existing placeholders are preserved; new findings get counters at
 * max(existing) + 1 per (source, rule). v1 cassettes are upgraded to v2
 * in place.
 */
import { color, isTty, stderr, stdout } from './cli-output.js'
import { walkCassettes } from './cli-walk.js'
import { loadConfigFromDir, loadConfigFromFile } from './config.js'
import { CassetteConfigError, CassetteNotFoundError } from './errors.js'
import { writeCassetteFile } from './io.js'
import { loadCassette } from './loader.js'
import { redact } from './redact.js'
import { aggregateEntries, seedCountersFromCassette } from './redact-pipeline.js'
import { serialize } from './serialize.js'
import type { CassetteFile, Recording, RedactConfig, RedactionEntry } from './types.js'
import { RECORDED_BY } from './version.js'

const RE_REDACT_HELP = `\
Usage:
  shell-cassette re-redact [paths...] [options]

Re-applies the current redaction rules to existing cassettes. Idempotent:
running twice yields identical output. Use this when the bundle expands or
when you add a custom rule and want to upgrade existing cassettes.

Existing placeholders are kept; new findings get counters at max(existing) + 1
per (source, rule). v1 cassettes are upgraded to v2 in place.

Exit codes:
  0   no new redactions applied (all cassettes already covered)
  1   at least one cassette modified
  2   error

Options:
  --dry-run           preview changes without writing
  --quiet             suppress stdout summary
  --config <path>     override config discovery
  --no-bundled        skip bundled patterns
  --no-color
  --color=always
  --help
`

type ColorOverride = 'auto' | 'always' | 'never'

type ReRedactFlags = {
  paths: string[]
  dryRun: boolean
  quiet: boolean
  configPath?: string
  noBundled: boolean
  colorOverride: ColorOverride
  help: boolean
}

function parseReRedactArgs(args: readonly string[]): ReRedactFlags {
  const flags: ReRedactFlags = {
    paths: [],
    dryRun: false,
    quiet: false,
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
    } else if (arg === '--dry-run') {
      flags.dryRun = true
    } else if (arg === '--quiet') {
      flags.quiet = true
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
 * Re-redact one or more cassette files or directories. Returns 0 if no new
 * redactions were applied, 1 if at least one cassette was modified (or would
 * be modified in dry-run), 2 on error.
 */
export async function runReRedact(args: readonly string[]): Promise<number> {
  let flags: ReRedactFlags
  try {
    flags = parseReRedactArgs(args)
  } catch (e) {
    stderr(`error: ${(e as Error).message}\n${RE_REDACT_HELP}`)
    return 2
  }

  if (flags.help) {
    stdout(RE_REDACT_HELP)
    return 0
  }

  if (flags.paths.length === 0) {
    stderr(`error: re-redact requires at least one path\n${RE_REDACT_HELP}`)
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

  let totalNew = 0
  let modifiedCount = 0
  for (const p of cassettePaths) {
    try {
      const result = await reRedactOne(p, effectiveRedact, flags.dryRun)
      totalNew += result.newRedactions
      if (result.modified) modifiedCount++
      if (!flags.quiet) {
        if (result.newRedactions === 0) {
          stdout(`${p}: ${color.green('clean')} (no new findings)`)
        } else if (flags.dryRun) {
          stdout(
            `${p}: ${color.yellow(`would redact ${result.newRedactions}`)} new findings (dry-run)`,
          )
        } else {
          stdout(`${p}: ${color.yellow(`${result.newRedactions} new redactions applied`)}`)
        }
      }
    } catch (e) {
      stderr(`${p}: error: ${(e as Error).message}`)
      return 2
    }
  }

  if (!flags.quiet) {
    if (flags.dryRun) {
      stdout(`dry-run: would redact ${totalNew} new findings across ${modifiedCount} cassette(s).`)
    } else {
      stdout(`re-redacted ${totalNew} new findings across ${modifiedCount} cassette(s).`)
    }
  }

  return totalNew > 0 ? 1 : 0
}

/**
 * Per-cassette re-redact entry point. Exported solely so the property test
 * in tests/property/re-redact-idempotence.property.test.ts can drive it
 * without spawning a subprocess. Internal-test consumer; not part of the
 * public API.
 */
export async function reRedactOne(
  cassettePath: string,
  config: Readonly<RedactConfig>,
  dryRun: boolean,
): Promise<{ modified: boolean; newRedactions: number }> {
  const cassette = await loadCassette(cassettePath)
  if (cassette === null) throw new CassetteNotFoundError(cassettePath)

  // Seed counters from existing placeholders so new findings continue the
  // per-(source, rule) sequence rather than restarting at 1.
  const counters = seedCountersFromCassette(cassette)
  let newCount = 0
  const updatedRecordings: Recording[] = []

  for (const rec of cassette.recordings) {
    const { recording, newCountInRecording } = reRedactRecording(rec, config, counters)
    updatedRecordings.push(recording)
    newCount += newCountInRecording
  }

  if (newCount === 0) return { modified: false, newRedactions: 0 }
  if (dryRun) return { modified: true, newRedactions: newCount }

  const updated: CassetteFile = {
    version: 2,
    recordedBy: RECORDED_BY,
    recordings: updatedRecordings,
  }
  await writeCassetteFile(cassettePath, serialize(updated))
  return { modified: true, newRedactions: newCount }
}

function reRedactRecording(
  rec: Recording,
  config: Readonly<RedactConfig>,
  counters: Map<string, number>,
): { recording: Recording; newCountInRecording: number } {
  const newEntries: RedactionEntry[] = []
  let newCount = 0

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(rec.call.env)) {
    const r = redact({ source: 'env', value }, config, { counted: true, counters })
    env[key] = r.output
    newEntries.push(...r.entries)
    newCount += r.entries.reduce((s, e) => s + e.count, 0)
  }

  const args = rec.call.args.map((arg) => {
    const r = redact({ source: 'args', value: arg }, config, { counted: true, counters })
    newEntries.push(...r.entries)
    newCount += r.entries.reduce((s, e) => s + e.count, 0)
    return r.output
  })

  const stdoutLines = rec.result.stdoutLines.map((line) => {
    const r = redact({ source: 'stdout', value: line }, config, { counted: true, counters })
    newEntries.push(...r.entries)
    newCount += r.entries.reduce((s, e) => s + e.count, 0)
    return r.output
  })

  const stderrLines = rec.result.stderrLines.map((line) => {
    const r = redact({ source: 'stderr', value: line }, config, { counted: true, counters })
    newEntries.push(...r.entries)
    newCount += r.entries.reduce((s, e) => s + e.count, 0)
    return r.output
  })

  const allLines =
    rec.result.allLines?.map((line) => {
      const r = redact({ source: 'allLines', value: line }, config, { counted: true, counters })
      newEntries.push(...r.entries)
      newCount += r.entries.reduce((s, e) => s + e.count, 0)
      return r.output
    }) ?? null

  // Concat-then-aggregate (rather than aggregate-then-merge) because existing
  // rec.redactions and newEntries may share (source, rule) keys; aggregateEntries
  // sums their counts in a single pass.
  const aggregated = aggregateEntries([...rec.redactions, ...newEntries])

  return {
    recording: {
      call: { ...rec.call, env, args },
      result: { ...rec.result, stdoutLines, stderrLines, allLines },
      redactions: aggregated,
    },
    newCountInRecording: newCount,
  }
}
