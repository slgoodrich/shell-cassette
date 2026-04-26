import { requireAckGate } from './ack.js'
import { type Config, getConfig } from './config.js'
import { ReplayMissError } from './errors.js'
import { loadCassette } from './loader.js'
import { MatcherState } from './matcher.js'
import { resolveMode } from './mode.js'
import { record } from './recorder.js'
import { getActiveCassette } from './state.js'
import type { Call, CassetteSession, MatcherStateLike, Recording, Result } from './types.js'

export type RunnerHooks<Opts, ResultShape> = {
  validate: (options: Opts | undefined) => void
  buildCall: (file: string, args: readonly string[], options: Opts) => Call
  realCall: (file: string, args: readonly string[], options: Opts) => Promise<ResultShape>
  captureResult: (raw: ResultShape | unknown) => Result
  synthesize: (rec: Recording, options: Opts) => ResultShape
}

export async function runWrapped<Opts, ResultShape>(
  file: string,
  args: readonly string[],
  options: Opts,
  hooks: RunnerHooks<Opts, ResultShape>,
): Promise<ResultShape> {
  hooks.validate(options)

  const session = getActiveCassette()
  if (session === null) {
    return hooks.realCall(file, args, options)
  }

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
    return hooks.realCall(file, args, options)
  }

  const call = hooks.buildCall(file, args, options)
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
    return hooks.synthesize(recording, options)
  }

  if (mode === 'auto') {
    const recording = matcher.findMatch(call)
    if (recording !== null) {
      return hooks.synthesize(recording, options)
    }
    // fall through to record path (auto-additive)
  }

  // mode is 'record' OR auto-with-no-match
  requireAckGate()
  try {
    const result = await hooks.realCall(file, args, options)
    captureAndRecord(call, result, hooks, session, config)
    return result
  } catch (err) {
    captureAndRecord(call, err, hooks, session, config)
    throw err
  }
}

function captureAndRecord<Opts, ResultShape>(
  call: Call,
  raw: ResultShape | unknown,
  hooks: RunnerHooks<Opts, ResultShape>,
  session: CassetteSession,
  config: Config,
): void {
  const result = hooks.captureResult(raw)
  record(call, result, session, config)
}

function ensureMatcher(matcher: MatcherStateLike | null): MatcherStateLike {
  if (matcher === null) {
    throw new Error('shell-cassette: matcher was not initialized before use (internal bug)')
  }
  return matcher
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
