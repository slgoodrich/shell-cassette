import { requireAckGate } from './ack.js'
import { type Config, getConfig } from './config.js'
import { NoActiveSessionError, ReplayMissError } from './errors.js'
import { loadCassette } from './loader.js'
import { MatcherState } from './matcher.js'
import { resolveMode } from './mode.js'
import { record } from './recorder.js'
import { getActiveCassette } from './state.js'
import type { Call, CassetteSession, MatcherStateLike, Recording, Result } from './types.js'

const NO_ACTIVE_SESSION_HELP = `shell-cassette is in replay mode but no active cassette session is bound.

Fix one of:
  - Wrap the call site with useCassette(path, async () => { ... })
  - Import 'shell-cassette/vitest' as a setupFile so the plugin auto-binds per test
  - Set SHELL_CASSETTE_MODE=passthrough to opt out of strict replay

CI=true forces replay mode by default; without a session shell-cassette refuses to run real subprocesses.`

export type RunnerHooks<Opts, ResultShape> = {
  validate: (options: Opts | undefined) => void
  buildCall: (file: string, args: readonly string[], options: Opts) => Call
  realCall: (file: string, args: readonly string[], options: Opts) => Promise<ResultShape>
  // The wrapper measures elapsed time around realCall and passes it here.
  // Adapters use this value rather than reading runner-provided fields so
  // the measurement is uniform across runners (execa exposes durationMs;
  // tinyexec does not).
  captureResult: (raw: unknown, durationMs: number) => Result
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

  // Resolve mode before the no-session passthrough check. If the user is in
  // replay mode (env-set or CI-forced) but no session is active, falling
  // through to realCall would silently run real subprocesses despite the
  // user's "no real shell" intent. Refuse instead.
  if (session === null) {
    const mode = resolveMode(
      process.env.SHELL_CASSETTE_MODE,
      Boolean(process.env.CI),
      'passthrough',
    )
    if (mode === 'replay') {
      throw new NoActiveSessionError(NO_ACTIVE_SESSION_HELP)
    }
    return hooks.realCall(file, args, options)
  }

  const config = getConfig()
  if (session.loadedFile === null) {
    session.loadedFile = await loadCassette(session.path)
    session.matcher = new MatcherState(session.loadedFile?.recordings ?? [], session.canonicalize)
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

  let cameFromAutoMiss = false
  if (mode === 'auto') {
    const recording = matcher.findMatch(call)
    if (recording !== null) {
      return hooks.synthesize(recording, options)
    }
    cameFromAutoMiss = true
    // fall through to record path (auto-additive)
  }

  // mode is 'record' OR auto-with-no-match
  try {
    requireAckGate()
  } catch (e) {
    // Default scope mode is 'auto'. When the matcher misses, the wrapper
    // falls through to the record path, which then asks for ack. From the
    // user's perspective they tried to replay; the ack error obscures the
    // real cause (matcher miss). Mutate the original error's message so the
    // actual problem path is visible. Stack and class are preserved —
    // programmatic catches on AckRequiredError still work.
    if (cameFromAutoMiss && e instanceof Error) {
      e.message = `auto mode: no recording matched \`${formatCallSignature(call)}\`, attempted to record but ack gate not set.\n\n${e.message}`
    }
    throw e
  }
  const start = performance.now()
  try {
    const result = await hooks.realCall(file, args, options)
    captureAndRecord(call, result, performance.now() - start, hooks, session, config)
    return result
  } catch (err) {
    captureAndRecord(call, err, performance.now() - start, hooks, session, config)
    throw err
  }
}

function captureAndRecord<Opts, ResultShape>(
  call: Call,
  raw: unknown,
  durationMs: number,
  hooks: RunnerHooks<Opts, ResultShape>,
  session: CassetteSession,
  config: Config,
): void {
  const result = hooks.captureResult(raw, durationMs)
  record(call, result, session, config)
}

function ensureMatcher(matcher: MatcherStateLike | null): MatcherStateLike {
  if (matcher === null) {
    throw new Error('shell-cassette: matcher was not initialized before use (internal bug)')
  }
  return matcher
}

function buildReplayMissError(call: Call, session: CassetteSession): ReplayMissError {
  const canonical = session.canonicalize(call)
  const recordedCalls = session.loadedFile?.recordings
    .map((r) => formatCallSignature(r.call))
    .join('\n  - ')
  const recordedCanonical = session.loadedFile?.recordings
    .map((r) => JSON.stringify(session.canonicalize(r.call)))
    .join('\n  - ')
  return new ReplayMissError(
    `no matching recording for \`${formatCallSignature(call)}\`
  cassette:        ${session.path}
  matcher:         canonicalize-then-equal (default normalizes mkdtemp paths in args)
  call canonical:  ${JSON.stringify(canonical)}

Recorded calls in this cassette:
  - ${recordedCalls ?? '(none)'}

Recorded canonical forms:
  - ${recordedCanonical ?? '(none)'}

To re-record: delete the cassette file and run tests again.`,
  )
}

function formatCallSignature(call: Call): string {
  return `${call.command} ${call.args.join(' ')}`
}
