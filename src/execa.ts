import type { Options, ResultPromise } from 'execa'
import { execa as realExeca } from 'execa'
import { requireAckGate } from './ack.js'
import { type Config, getConfig } from './config.js'
import { ReplayMissError } from './errors.js'
import { loadCassette } from './loader.js'
import { MatcherState } from './matcher.js'
import { resolveMode } from './mode.js'
import { validateOptions } from './options.js'
import { record } from './recorder.js'
import { getActiveCassette } from './state.js'
import type { Call, CassetteSession, MatcherStateLike, Recording, Result } from './types.js'

export function execa(
  file: string,
  args?: readonly string[],
  options?: Options,
): ResultPromise<Options> {
  return runExeca(file, args ?? [], options ?? {}) as ResultPromise<Options>
}

async function runExeca(file: string, args: readonly string[], options: Options): Promise<unknown> {
  validateOptions(options as Record<string, unknown>)

  const session = getActiveCassette()
  if (session === null) {
    return realExeca(file, args, options)
  }

  // Lazy load cassette + build matcher on first call in scope
  const config = getConfig()
  if (session.loadedFile === null) {
    session.loadedFile = await loadCassette(session.path)
    session.matcher = new MatcherState(session.loadedFile?.recordings ?? [], config.matcher)
  }

  const mode = resolveMode(
    process.env.SHELL_CASSETTE_MODE,
    Boolean(process.env.CI),
    session.scopeDefault,
  )

  if (mode === 'passthrough') {
    return realExeca(file, args, options)
  }

  const call = buildCall(file, args, options)
  const matcher = ensureMatcher(session.matcher)

  if (mode === 'replay') {
    if (session.loadedFile === null) {
      throw new ReplayMissError(
        `no cassette at ${session.path}; run with SHELL_CASSETTE_MODE=record to create.`,
      )
    }
    const recording = matcher.findMatch(call)
    if (recording === null) {
      throw buildReplayMissError(call, session)
    }
    return synthesize(recording, options)
  }

  if (mode === 'auto') {
    const recording = matcher.findMatch(call)
    if (recording !== null) {
      return synthesize(recording, options)
    }
    // fall through to record path (auto-additive)
  }

  // mode is 'record' OR auto-with-no-match
  requireAckGate()
  try {
    const result = await realExeca(file, args, options)
    captureRecording(call, result, session, config)
    return result
  } catch (err) {
    // execa errors propagate; capture failure first
    captureRecording(call, err, session, config)
    throw err
  }
}

function ensureMatcher(matcher: MatcherStateLike | null): MatcherStateLike {
  if (matcher === null) {
    throw new Error('shell-cassette: matcher was not initialized before use (internal bug)')
  }
  return matcher
}

function buildCall(file: string, args: readonly string[], options: Options): Call {
  return {
    command: file,
    args: [...args],
    cwd: (options.cwd as string | undefined) ?? null,
    env: (options.env as Record<string, string> | undefined) ?? {},
    stdin: null,
  }
}

function captureRecording(
  call: Call,
  execaResult: unknown,
  session: CassetteSession,
  config: Config,
): void {
  const r = execaResult as {
    stdout?: string | string[]
    stderr?: string | string[]
    all?: string | string[]
    exitCode?: number
    signal?: string | null
    durationMs?: number
  }
  const result: Result = {
    stdoutLines: toLines(r.stdout),
    stderrLines: toLines(r.stderr),
    allLines: r.all === undefined ? null : toLines(r.all),
    exitCode: r.exitCode ?? 0,
    signal: r.signal ?? null,
    durationMs: r.durationMs ?? 0,
  }
  record(call, result, session, config)
}

function toLines(input: string | string[] | undefined): string[] {
  if (input === undefined) return ['']
  if (Array.isArray(input)) return [...input, '']
  return input.split('\n')
}

function synthesize(rec: Recording, options: Options): unknown {
  const stdout = rec.result.stdoutLines.join('\n')
  const stderr = rec.result.stderrLines.join('\n')
  const result: Record<string, unknown> = {
    stdout: options.lines === true ? rec.result.stdoutLines.slice(0, -1) : stdout,
    stderr,
    exitCode: rec.result.exitCode,
    signal: rec.result.signal,
    durationMs: rec.result.durationMs,
    failed: rec.result.exitCode !== 0,
    timedOut: false,
    isCanceled: false,
    killed: rec.result.signal !== null,
    command: `${rec.call.command} ${rec.call.args.join(' ')}`,
    escapedCommand: rec.call.command,
  }
  if (options.all === true) {
    // Use recorded interleaved output when present; fall back to stdout+stderr concat for legacy cassettes.
    const allLines = rec.result.allLines ?? [...rec.result.stdoutLines, ...rec.result.stderrLines]
    result.all = allLines.join('\n')
  }

  // If reject is true (default) and exit !== 0, throw an Error shaped like ExecaError
  if (options.reject !== false && rec.result.exitCode !== 0) {
    const err = Object.assign(
      new Error(`Command failed with exit code ${rec.result.exitCode}: ${result.command}`),
      result,
      { name: 'ExecaError' },
    )
    throw err
  }

  return result
}

function buildReplayMissError(call: Call, session: CassetteSession): ReplayMissError {
  const recordedCalls = session.loadedFile?.recordings
    .map((r) => `${r.call.command} ${r.call.args.join(' ')}`)
    .join('\n  - ')
  return new ReplayMissError(
    `no matching recording for \`${call.command} ${call.args.join(' ')}\`
  cassette: ${session.path}
  matcher:  default (command + deep-equal args)

Recorded calls in this cassette:
  - ${recordedCalls ?? '(none)'}

To re-record: delete the cassette file and run tests again.`,
  )
}
