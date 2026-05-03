import type { Options, ResultPromise } from 'execa'
import { MissingPeerDependencyError, UnsupportedOptionError } from './errors.js'
import { captureResult } from './execa-capture.js'
import { readInputFile } from './io.js'
import { validateOptions } from './options-execa.js'
import type { Call, Recording } from './types.js'
import { type RunnerHooks, runWrapped } from './wrapper.js'

// Reused across every synth call. `pipe` and async iteration always
// throw the same error; `kill` always returns false; the empty arrays
// are frozen so callers can't mutate them between replays.
const FROZEN_EMPTY_ARRAY: readonly never[] = Object.freeze([])

const REPLAY_KILL_STUB = (): boolean => false

const REPLAY_PIPE_STUB = (): never => {
  throw new UnsupportedOptionError(
    'execa result.pipe() not supported on replay (no live subprocess). ' +
      'Use SHELL_CASSETTE_MODE=passthrough for tests that pipe subprocesses.',
  )
}

const REPLAY_ASYNC_ITER_STUB = (): never => {
  throw new UnsupportedOptionError(
    'execa async iteration `for await (line of subprocess)` not supported on replay. ' +
      'Read result.stdout (string or array form via lines option) instead.',
  )
}

// Resolve execa via dynamic import so we can wrap "Cannot find module" with
// an actionable error. Top-level await here means consumers importing
// shell-cassette/execa wait for this resolution. If execa isn't installed,
// shell-cassette/execa fails to load with a clear install instruction.
let realExeca: typeof import('execa').execa
try {
  const mod = await import('execa')
  realExeca = mod.execa
} catch (e) {
  throw new MissingPeerDependencyError(
    'shell-cassette/execa requires execa as a peer dependency.\n\n' +
      'Install it:\n' +
      '  npm install execa\n' +
      '  pnpm add execa\n' +
      '  yarn add execa\n\n' +
      `Original error: ${(e as Error).message}`,
  )
}

export function execa(
  file: string,
  args?: readonly string[],
  options?: Options,
): ResultPromise<Options> {
  return runWrapped(file, args ?? [], options ?? {}, execaHooks) as ResultPromise<Options>
}

// Mirrors real execa's `execaNode`: runs the script under the current Node
// runtime by forcing `node: true`. The user-provided file is preserved as
// `Call.command` (e.g. `'script.mjs'`, not `'node script.mjs'`), and the
// `node` flag is not stored in the cassette. So `execaNode(f)` and
// `execa(f, [], { node: true })` share recordings via canonical form.
export function execaNode(
  file: string,
  args?: readonly string[],
  options?: Options,
): ResultPromise<Options> {
  return execa(file, args, { ...options, node: true })
}

const execaHooks: RunnerHooks<Options, unknown> = {
  validate: (opts) => validateOptions(opts as Record<string, unknown> | undefined),
  buildCall,
  realCall,
  captureResult,
  synthesize,
}

// When buildCall already resolved `inputFile` into `Call.stdin`, swap the
// option so real execa consumes the resolved string via `input` instead of
// re-reading the file. The branch only fires on the record path
// (passthrough/no-session pass `resolvedStdin: undefined`). buildCall's
// contract: when inputFile is defined, stdin is always a string (possibly
// empty), never null — so a string-typeof check covers the optimization
// case without a redundant null branch. Closes #102.
function realCall(
  file: string,
  args: readonly string[],
  options: Options,
  resolvedStdin: string | null | undefined,
): Promise<unknown> {
  let opts = options
  if (typeof resolvedStdin === 'string' && options.inputFile !== undefined) {
    const { inputFile: _, ...rest } = options as Options & { inputFile?: unknown }
    opts = { ...rest, input: resolvedStdin } as Options
  }
  return realExeca(file, args, opts) as unknown as Promise<unknown>
}

async function buildCall(file: string, args: readonly string[], options: Options): Promise<Call> {
  // Validator already rejected the invalid shapes (Uint8Array/Readable input,
  // input+inputFile conflict). At this point `input` is either undefined,
  // null, or a string; `inputFile` is either undefined or a string-like.
  let stdin: string | null = null
  if (typeof options.input === 'string') {
    stdin = options.input
  } else if (options.inputFile !== undefined) {
    // Strict-read: failure here propagates as BinaryInputError or
    // CassetteIOError. Reading before the matcher runs means binary input
    // throws before producing a misleading ReplayMissError.
    stdin = await readInputFile(options.inputFile as string | URL)
  }
  return {
    command: file,
    args: [...args],
    cwd: (options.cwd as string | undefined) ?? null,
    env: (options.env as Record<string, string> | undefined) ?? {},
    stdin,
  }
}

// Resolve execa's `lines` option to per-stream booleans. The object form lets
// users set `lines` independently per fd, e.g. `{ stdout: true, stderr: false }`.
// Precedence matches execa's own resolution (see node_modules/execa/types/
// arguments/specific.d.ts FdNumberToFromOption): for fd1, `stdout` wins over
// `fd1` wins over `all`; for fd2, `stderr` wins over `fd2` wins over `all`.
// The `??` cascade matches that semantics: the first non-nullish key in the
// chain decides the value. The OR-form (`a === true || b === true`) was
// rejected because it gives the wrong shape on conflicting keys (e.g.
// `{ stdout: false, all: true }` should yield string stdout, not array).
function resolveLines(lines: Options['lines']): { stdout: boolean; stderr: boolean; all: boolean } {
  if (lines === true) return { stdout: true, stderr: true, all: true }
  if (lines === false || lines === undefined || typeof lines !== 'object' || lines === null) {
    return { stdout: false, stderr: false, all: false }
  }
  // execa's lines object type is structurally complex (FdGenericOption<boolean>);
  // cast to a uniform key→bool map for the ?? cascade.
  const o = lines as Record<string, boolean | undefined>
  const stdout = o.stdout ?? o.fd1 ?? o.all ?? false
  const stderr = o.stderr ?? o.fd2 ?? o.all ?? false
  const all = o.all ?? false
  return { stdout, stderr, all }
}

// The cassette format does not encode whether a recording's stdout/stderr was
// originally a string or an array. `toLines` on capture appends '' as a
// trailing marker only when the source was an array OR a string that ended in
// '\n' (split('\n') leaves a trailing '' in that case). A plain string without
// a trailing newline records as `['foo']` (no marker). On replay under
// `lines: true`, unconditionally trimming the last element over-trims that
// case. Conditional slice: only drop the last element when it actually IS the
// '' marker. Handles both old and new cassettes.
function dropTrailingMarker(lines: readonly string[]): string[] {
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines.slice()
}

function synthesize(rec: Recording, options: Options): unknown {
  const linesByStream = resolveLines(options.lines)
  const stdoutAsString = rec.result.stdoutLines.join('\n')
  const stderrAsString = rec.result.stderrLines.join('\n')
  const stdout = linesByStream.stdout ? dropTrailingMarker(rec.result.stdoutLines) : stdoutAsString
  const stderr = linesByStream.stderr ? dropTrailingMarker(rec.result.stderrLines) : stderrAsString
  const all =
    options.all === true
      ? linesByStream.all
        ? rec.result.allLines
          ? dropTrailingMarker(rec.result.allLines)
          : []
        : (rec.result.allLines?.join('\n') ?? stdoutAsString + stderrAsString)
      : undefined
  // Resolve failed: stored value when present; otherwise derive from
  // exit/signal/abort state. The fallback covers signal kill and aborted
  // cases the old `exitCode !== 0` check missed and lets cassettes
  // recorded before the field was added auto-upgrade their replay
  // correctness without re-recording.
  const failed =
    rec.result.failed ??
    (rec.result.exitCode !== 0 || rec.result.signal !== null || rec.result.aborted)

  const isTerminated = rec.result.signal !== null

  const result = {
    stdout,
    stderr,
    exitCode: rec.result.exitCode,
    signal: rec.result.signal,
    durationMs: rec.result.durationMs,
    command: `${rec.call.command} ${rec.call.args.join(' ')}`,
    escapedCommand: rec.call.command,
    failed,
    timedOut: rec.result.timedOut ?? false,
    isCanceled: rec.result.aborted,
    isMaxBuffer: rec.result.isMaxBuffer ?? false,
    isTerminated,
    isForcefullyTerminated: rec.result.isForcefullyTerminated ?? false,
    isGracefullyCanceled: rec.result.isGracefullyCanceled ?? false,
    // Stored value when present; fall back to isTerminated for legacy
    // cassettes recorded before `killed` was captured separately.
    killed: rec.result.killed ?? isTerminated,

    // pipedFrom: no chained subprocess on replay. ipcOutput: ipc: true
    // is rejected at validation.
    pipedFrom: FROZEN_EMPTY_ARRAY,
    ipcOutput: FROZEN_EMPTY_ARRAY,

    ...(all !== undefined && { all }),

    // No live subprocess on replay. kill() returns false (mirrors
    // execa's "did not signal" return); pipe() and async iteration
    // throw with actionable messages. Stream methods (iterable,
    // readable, writable, duplex) are not stubbed.
    kill: REPLAY_KILL_STUB,
    pipe: REPLAY_PIPE_STUB,
    [Symbol.asyncIterator]: REPLAY_ASYNC_ITER_STUB,
  }

  if (options.reject !== false && failed) {
    const err = Object.assign(
      new Error(`Command failed with exit code ${rec.result.exitCode}: ${result.command}`),
      result,
      { name: 'ExecaError' },
    )
    throw err
  }

  return result
}
