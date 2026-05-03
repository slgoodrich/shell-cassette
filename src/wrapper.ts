import { requireAckGate } from './ack.js'

import { NoActiveSessionError, ReplayMissError } from './errors.js'
import { loadCassette } from './loader.js'
import { MatcherState } from './matcher.js'
import { resolveMode } from './mode.js'
import { record } from './recorder.js'
import { seedCountersFromCassette } from './redact-pipeline.js'
import { getActiveCassette } from './state.js'
import type { Call, CassetteSession, LoadedSession, Recording, Result } from './types.js'

const NO_ACTIVE_SESSION_HELP = `shell-cassette is in replay mode but no active cassette session is bound.

Fix one of:
  - Wrap the call site with useCassette(path, async () => { ... })
  - Import 'shell-cassette/vitest' as a setupFile so the plugin auto-binds per test
  - Set SHELL_CASSETTE_MODE=passthrough to opt out of strict replay

CI=true forces replay mode by default; without a session shell-cassette refuses to run real subprocesses.`

export type RunnerHooks<Opts, ResultShape> = {
  validate: (options: Opts | undefined) => void
  buildCall: (file: string, args: readonly string[], options: Opts) => Promise<Call>
  /**
   * Invokes the real runner. `resolvedStdin` carries `call.stdin` when
   * `buildCall` already ran (record path); it is `undefined` on the
   * passthrough/no-session paths where `buildCall` is skipped.
   *
   * Adapters use it to avoid duplicating side effects buildCall already
   * performed. The execa adapter swaps `options.inputFile` for
   * `input: resolvedStdin` when both are present, so real execa does not
   * re-read the file (#102).
   */
  realCall: (
    file: string,
    args: readonly string[],
    options: Opts,
    resolvedStdin: string | null | undefined,
  ) => Promise<ResultShape>
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
    return hooks.realCall(file, args, options, undefined)
  }

  const loaded = await ensureSessionLoaded(session)

  const mode = resolveMode(
    process.env.SHELL_CASSETTE_MODE,
    Boolean(process.env.CI),
    loaded.scopeDefault,
  )

  if (mode === 'passthrough') {
    return hooks.realCall(file, args, options, undefined)
  }

  const call = await hooks.buildCall(file, args, options)

  if (mode === 'replay') {
    if (loaded.loadedFile === null) {
      throw new ReplayMissError(
        `no cassette at ${loaded.path}; run with SHELL_CASSETTE_MODE=record to create.`,
      )
    }
    const recording = loaded.matcher.findMatch(call)
    if (recording === null) {
      const hint = hasNodeFlag(options) ? `\n\n${NODE_FLAG_HINT}` : ''
      throw buildReplayMissError(call, loaded, hint)
    }
    return hooks.synthesize(recording, options)
  }

  let cameFromAutoMiss = false
  if (mode === 'auto') {
    const recording = loaded.matcher.findMatch(call)
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
    // actual problem path is visible. Stack and class are preserved;
    // programmatic catches on AckRequiredError still work.
    if (cameFromAutoMiss && e instanceof Error) {
      e.message = `auto mode: no recording matched \`${formatCallSignature(call)}\`, attempted to record but ack gate not set.\n\n${e.message}`
    }
    throw e
  }
  const start = performance.now()
  try {
    const result = await hooks.realCall(file, args, options, call.stdin)
    captureAndRecord(call, result, performance.now() - start, hooks, loaded)
    return result
  } catch (err) {
    captureAndRecord(call, err, performance.now() - start, hooks, loaded)
    throw err
  }
}

/**
 * Ensures the session has completed lazy-load, returning a LoadedSession.
 * If `session.matcher` is already non-null, returns the session as-is (fast
 * path; TS narrows the union via the discriminant). Otherwise performs the
 * one-time lazy-load: reads the cassette file from disk, seeds redact
 * counters, and initializes the matcher.
 *
 * Keying on `matcher === null` (rather than `loadedFile === null`) is
 * intentional: `loadedFile` stays null for brand-new cassettes even after
 * lazy-load, so keying on it would re-run the load block on every call.
 * The matcher is always set unconditionally on first load, so it is the
 * correct single-use sentinel.
 *
 * The slow-path `as unknown as LoadedSession` casts are needed because TS
 * can't track in-place field mutation on a discriminated-union member: we
 * unconditionally assign `session.matcher = new MatcherState(...)` before
 * casting, so the runtime shape satisfies LoadedSession at that point.
 */
async function ensureSessionLoaded(session: CassetteSession): Promise<LoadedSession> {
  if (session.matcher !== null) {
    return session
  }
  const cassetteFile = await loadCassette(session.path)
  if (cassetteFile !== null) {
    // Widen to unknown first because PendingSession.loadedFile is typed as
    // null (literal). The field assignment is safe: the mutation promotes this
    // PendingSession to a LoadedSession, which we return below.
    ;(session as unknown as LoadedSession).loadedFile = cassetteFile
    // Seed redact counters from existing cassette placeholders so
    // auto-additive appends continue from the existing per-(source, rule)
    // ceiling. Spec Q5 + counter rebuild on cassette load.
    const seeded = seedCountersFromCassette(cassetteFile)
    for (const [k, v] of seeded) {
      session.redactCounters.set(k, v)
    }
  }
  ;(session as unknown as LoadedSession).matcher = new MatcherState(
    cassetteFile?.recordings ?? [],
    session.canonicalize,
    session.redactConfig,
  )
  return session as unknown as LoadedSession
}

function captureAndRecord<Opts, ResultShape>(
  call: Call,
  raw: unknown,
  durationMs: number,
  hooks: RunnerHooks<Opts, ResultShape>,
  session: LoadedSession,
): void {
  const result = hooks.captureResult(raw, durationMs)
  record(call, result, session)
}

const REPLAY_MISS_DIAGNOSTIC_LIMIT = 10

// Adapter-specific hint helpers. Kept here at one instance; refactor to a
// hooks-based design (e.g., `RunnerHooks.buildMissHints`) at the third hint.
function hasNodeFlag(options: unknown): boolean {
  return (
    typeof options === 'object' && options !== null && (options as { node?: unknown }).node === true
  )
}

const NODE_FLAG_HINT = `(canonical forms ignore the \`node\` flag. \`execaNode(f)\` and \`execa(f, [], { node: true })\` share recordings with calls made without the flag. If you mix node-mode and non-node-mode for the same command in one test, the cassette may serve the wrong recording.)`

/**
 * Constructs a `ReplayMissError` for an in-session matcher miss. The `hint`
 * parameter is required (no default) so callers must compute it deliberately;
 * a silent empty default would drop hint content at refactor time without any
 * compile-time signal. Pass `''` when no hint applies.
 */
function buildReplayMissError(call: Call, session: LoadedSession, hint: string): ReplayMissError {
  const canonical = session.canonicalize(call, session.redactConfig)
  const recordings = session.loadedFile?.recordings ?? []
  const shown = recordings.slice(0, REPLAY_MISS_DIAGNOSTIC_LIMIT)
  const truncated =
    recordings.length > REPLAY_MISS_DIAGNOSTIC_LIMIT
      ? `\n  ... (${recordings.length - REPLAY_MISS_DIAGNOSTIC_LIMIT} more)`
      : ''
  const recordedCalls = shown.length
    ? shown.map((r) => formatCallSignature(r.call)).join('\n  - ') + truncated
    : '(none)'
  const recordedCanonical = shown.length
    ? shown
        .map((r) => JSON.stringify(session.canonicalize(r.call, session.redactConfig)))
        .join('\n  - ') + truncated
    : '(none)'
  return new ReplayMissError(
    `no matching recording for \`${formatCallSignature(call)}\`
  cassette:        ${session.path}
  matcher:         canonicalize-then-equal (default normalizes mkdtemp paths in args)
  call canonical:  ${JSON.stringify(canonical)}

Recorded calls in this cassette:
  - ${recordedCalls}

Recorded canonical forms:
  - ${recordedCanonical}

To re-record: delete the cassette file and run tests again.${hint}`,
  )
}

function formatCallSignature(call: Call): string {
  return `${call.command} ${call.args.join(' ')}`
}
