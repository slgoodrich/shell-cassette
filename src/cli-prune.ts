/**
 * `shell-cassette prune` subcommand. Remove recordings by 0-based index.
 *
 * v0.5 modes (no interactive walk):
 *   - `--delete <indexes>`: comma-separated 0-based indexes to remove.
 *   - `--json`: read-only structured listing (`pruneVersion: 1`).
 *   - `--help`: usage.
 *
 * Bare `prune <path>` (no flags) is an error. Workflow:
 * `prune --json | jq` to pick indexes, then `prune --delete <list>`.
 */
import { type ColorOverride, setupCliColor, stderr, stdout } from './cli-output.js'
import { CassetteConfigError, CassetteNotFoundError } from './errors.js'
import { writeCassetteFile } from './io.js'
import { loadCassette } from './loader.js'
import { serialize } from './serialize.js'
import type { CassetteFile } from './types.js'
import { RECORDED_BY } from './version.js'

const PRUNE_VERSION = 1

const PRUNE_HELP = `\
Usage:
  shell-cassette prune <path> --delete <indexes>
  shell-cassette prune <path> --json
  shell-cassette prune <path> --help

Remove recordings from a cassette by 0-based index.

Workflow: shell-cassette prune <path> --json | jq -r ... to pick indexes,
then shell-cassette prune <path> --delete <comma-separated list>.

Exit codes:
  0   ok
  2   error (missing path, bad flags, out-of-range or duplicate index)

Options:
  --delete <indexes>   comma-separated 0-based indexes to remove
  --json               read-only structured listing (pruneVersion: 1)
  --quiet              suppress stdout summary on --delete
  --no-color
  --color=always
  --help
`

export type PruneFlags = {
  path: string | null
  delete: number[] | null
  json: boolean
  quiet: boolean
  colorOverride: ColorOverride
  help: boolean
}

export function parsePruneArgs(args: readonly string[]): PruneFlags {
  const flags: PruneFlags = {
    path: null,
    delete: null,
    json: false,
    quiet: false,
    colorOverride: 'auto',
    help: false,
  }
  for (let i = 0; i < args.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
    const arg = args[i]!
    if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--quiet') flags.quiet = true
    else if (arg === '--no-color') flags.colorOverride = 'never'
    else if (arg === '--color=always') flags.colorOverride = 'always'
    else if (arg === '--delete') {
      const next = args[++i]
      if (next === undefined)
        throw new CassetteConfigError('--delete requires a comma-separated list of indexes')
      flags.delete = parseIndexList(next)
    } else if (arg.startsWith('--delete=')) {
      flags.delete = parseIndexList(arg.slice('--delete='.length))
    } else if (arg.startsWith('--')) {
      throw new CassetteConfigError(`unknown flag: ${arg}`)
    } else {
      if (flags.path !== null) throw new CassetteConfigError('prune takes exactly one path')
      flags.path = arg
    }
  }
  return flags
}

function parseIndexList(s: string): number[] {
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0) {
    throw new CassetteConfigError('--delete: list cannot be empty')
  }
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      throw new CassetteConfigError(`--delete: '${p}' is not a non-negative integer`)
    }
    out.push(Number.parseInt(p, 10))
  }
  return out
}

export async function runPrune(args: readonly string[]): Promise<number> {
  let flags: PruneFlags
  try {
    flags = parsePruneArgs(args)
  } catch (e) {
    stderr(`error: ${(e as Error).message}\n${PRUNE_HELP}`)
    return 2
  }

  if (flags.help) {
    stdout(PRUNE_HELP)
    return 0
  }
  if (flags.path === null) {
    stderr(`error: prune requires a path\n${PRUNE_HELP}`)
    return 2
  }

  setupCliColor(flags.colorOverride)

  let cassette: CassetteFile
  try {
    const loaded = await loadCassette(flags.path)
    if (loaded === null) throw new CassetteNotFoundError(flags.path)
    cassette = loaded
  } catch (e) {
    stderr(`error: ${(e as Error).message}`)
    return 2
  }

  if (flags.json) return runJsonMode(cassette)
  if (flags.delete !== null) return runDeleteMode(cassette, flags)

  stderr('error: prune requires --delete <indexes> or --json. See `prune --help`.')
  return 2
}

function runJsonMode(cassette: CassetteFile): number {
  const recordings = cassette.recordings.map((rec, index) => ({
    index,
    command: rec.call.command,
    args: rec.call.args,
    exitCode: rec.result.exitCode,
    durationMs: rec.result.durationMs,
    redactionCount: rec.redactions.reduce((s, e) => s + e.count, 0),
  }))
  stdout(JSON.stringify({ pruneVersion: PRUNE_VERSION, recordings }, null, 2))
  return 0
}

async function runDeleteMode(cassette: CassetteFile, flags: PruneFlags): Promise<number> {
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees flags.delete is non-null
  const indexes = flags.delete!
  const seen = new Set<number>()
  for (const idx of indexes) {
    if (idx < 0 || idx >= cassette.recordings.length) {
      stderr(
        `error: index ${idx} out of range (cassette has ${cassette.recordings.length} recording(s))`,
      )
      return 2
    }
    if (seen.has(idx)) {
      stderr(`error: duplicate index ${idx} in --delete list`)
      return 2
    }
    seen.add(idx)
  }

  const filtered = cassette.recordings.filter((_, i) => !seen.has(i))
  const updated: CassetteFile = {
    version: 2,
    recordedBy: RECORDED_BY,
    recordings: filtered,
  }
  // biome-ignore lint/style/noNonNullAssertion: validated above
  await writeCassetteFile(flags.path!, serialize(updated))
  if (!flags.quiet) {
    stdout(
      `Wrote 1 cassette. ${indexes.length} recording${indexes.length === 1 ? '' : 's'} deleted.`,
    )
  }
  return 0
}
