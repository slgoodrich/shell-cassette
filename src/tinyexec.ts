import type { Options, Result as TinyResult } from 'tinyexec'
import { MissingPeerDependencyError, ShellCassetteError, UnsupportedOptionError } from './errors.js'
import { validateOptions } from './options-tinyexec.js'
import { captureResult } from './tinyexec-capture.js'
import type { Call, Recording } from './types.js'
import { type RunnerHooks, runWrapped } from './wrapper.js'

export type { Options, Result } from 'tinyexec'

// Resolve tinyexec via dynamic import so we can wrap "Cannot find module"
// with an actionable error. Top-level await here means consumers importing
// shell-cassette/tinyexec wait for this resolution. If tinyexec isn't
// installed, shell-cassette/tinyexec fails to load with a clear install
// instruction.
let realX: typeof import('tinyexec').x
try {
  const mod = await import('tinyexec')
  realX = mod.x
} catch (e) {
  throw new MissingPeerDependencyError(
    'shell-cassette/tinyexec requires tinyexec as a peer dependency.\n\n' +
      'Install it:\n' +
      '  npm install tinyexec\n' +
      '  pnpm add tinyexec\n' +
      '  yarn add tinyexec\n\n' +
      `Original error: ${(e as Error).message}`,
  )
}

export function x(
  file: string,
  args?: readonly string[],
  options?: Partial<Options>,
): Promise<TinyResult> {
  return runWrapped(file, args ?? [], options ?? {}, tinyexecHooks)
}

const tinyexecHooks: RunnerHooks<Partial<Options>, TinyResult> = {
  validate: (opts) => validateOptions(opts as Record<string, unknown> | undefined),
  buildCall,
  realCall,
  captureResult,
  synthesize,
}

// tinyexec's Result is `PromiseLike<Output> & OutputApi`. Awaiting it resolves
// to Output (`{ stdout, stderr, exitCode }`) and drops the OutputApi getters
// (`aborted`, `killed`). To capture those on the record path we snapshot them
// from the ExecProcess BEFORE the await resolves, then return an enriched
// plain object the cassette captureResult can read. Fixes #126.
//
// `_resolvedStdin` is part of RunnerHooks.realCall's signature for the execa
// adapter's #102 optimization; tinyexec has no `inputFile` option and ignores
// it.
async function realCall(
  file: string,
  args: readonly string[],
  options: Partial<Options>,
  _resolvedStdin: string | null | undefined,
): Promise<TinyResult> {
  const proc = realX(file, [...args], options)
  const output = await proc
  const enriched = { ...output, aborted: proc.aborted, killed: proc.killed }
  // Cast: the enriched plain object lacks tinyexec's full Result shape (no
  // OutputApi methods, no PromiseLike). The wrapper passes this to
  // captureResult and (on record path) returns it to the user. Live ProcessApi
  // calls post-await are a known replay limitation, see synthesize() comment.
  return enriched as unknown as TinyResult
}

async function buildCall(
  file: string,
  args: readonly string[],
  options: Partial<Options>,
): Promise<Call> {
  const nodeOptions = (options as { nodeOptions?: { cwd?: string; env?: NodeJS.ProcessEnv } })
    .nodeOptions
  return {
    command: file,
    args: [...args],
    cwd: nodeOptions?.cwd ?? null,
    env: (nodeOptions?.env as Record<string, string> | undefined) ?? {},
    stdin: typeof options.stdin === 'string' ? options.stdin : null,
  }
}

function synthesize(rec: Recording, options: Partial<Options>): TinyResult {
  const stdout = rec.result.stdoutLines.join('\n')
  const stderr = rec.result.stderrLines.join('\n')
  // Stored value when present; fall back to signal-derived for legacy cassettes
  // recorded before `killed` was captured separately. Closes #129.
  const killed = rec.result.killed ?? rec.result.signal !== null

  const result = {
    stdout,
    stderr,
    exitCode: rec.result.exitCode,
    pid: -1,
    aborted: rec.result.aborted,
    killed,
    pipe: () => {
      throw new UnsupportedOptionError(
        'tinyexec result.pipe() not supported on replay (no live subprocess).',
      )
    },
    kill: () => {
      // no-op on replay; subprocess never spawned
    },
    [Symbol.asyncIterator]: () => {
      throw new UnsupportedOptionError(
        'tinyexec async iteration `for await (line of result)` not supported on replay.',
      )
    },
  }

  // Resolve failed via fallback derivation: stored value when present;
  // otherwise derived from exit/signal/abort state. The fallback covers
  // signal kill and aborted cases the old `exitCode !== 0` check missed
  // and lets cassettes recorded before the field was added auto-upgrade
  // their replay correctness without re-recording.
  const failed =
    rec.result.failed ??
    (rec.result.exitCode !== 0 || rec.result.signal !== null || rec.result.aborted)

  if ((options as { throwOnError?: boolean }).throwOnError === true && failed) {
    throw Object.assign(
      new Error(
        `Process exited with non-zero code: ${rec.result.exitCode} (command: ${rec.call.command})`,
      ),
      result,
    )
  }

  // Attach `process` as a throwing getter AFTER the throwOnError branch so
  // Object.assign(error, result) above does not trigger the throw by reading
  // the getter while copying enumerable properties. Reads on the success path
  // surface a clear error instead of a confusing TypeError on a downstream
  // property access. shell-cassette cannot synthesize a live ChildProcess
  // from a cassette; tests that need streaming or sync stdio must use
  // SHELL_CASSETTE_MODE=passthrough. Closes #83.
  Object.defineProperty(result, 'process', {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new ShellCassetteError(
        'result.process is not available in replay mode. shell-cassette synthesizes ' +
          'subprocess results from cassettes; no live ChildProcess exists. ' +
          'Tests that read result.process.stdout / .stderr / .stdin streams must ' +
          'either run with SHELL_CASSETTE_MODE=passthrough, or refactor to read ' +
          'result.stdout / result.stderr (the buffered fields).',
      )
    },
  })

  // The synthesized object lacks tinyexec's full structural shape (no `then`/`spawn`
  // fields from ExecProcess; `process` is a throwing getter rather than a live
  // ChildProcess). Documented replay limit: code reading these fields synchronously
  // before await, or calling sync-only ProcessApi methods, must use real execution.
  return result as unknown as TinyResult
}

/**
 * Alias for `x`. tinyexec exports both names (they reference the same callable);
 * mirroring that here lets users redirect `import { exec } from 'tinyexec'` to
 * `import { exec } from 'shell-cassette/tinyexec'` without renaming at every
 * call site. Closes #77.
 */
export const exec = x

/**
 * Stub for tinyexec's sync subprocess entry point. Wrapping sync execution
 * requires synchronous lazy-load support; tracked in #82.
 *
 * Calling xSync through this adapter throws a clear error instead of failing
 * silently or returning undefined. Users with sync subprocess tests should
 * either import xSync directly from `tinyexec` (those calls bypass
 * shell-cassette), or refactor to use async `x` (recommended; gets cassette
 * coverage).
 */
export function xSync(): never {
  throw new ShellCassetteError(
    'shell-cassette/tinyexec.xSync is not yet wrapped (tracked in #82). ' +
      'Sync subprocess wrapping requires synchronous lazy-load support. ' +
      'Use async `x` (recommended; gets cassette coverage), or import xSync ' +
      'directly from `tinyexec` (those calls will not be cassetted).',
  )
}
