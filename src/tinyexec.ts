import type { Options, Result as TinyResult } from 'tinyexec'
import { MissingPeerDependencyError, ShellCassetteError, UnsupportedOptionError } from './errors.js'
import { validateOptions } from './options-tinyexec.js'
import type { Call, Result as CassetteResult, Recording } from './types.js'
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
  // tinyexec's Result is structurally a PromiseLike & OutputApi, not Promise<Result>;
  // double-cast through unknown is needed to satisfy the hook's Promise<ResultShape> signature
  realCall: (file, args, options) =>
    realX(file, [...args], options) as unknown as Promise<TinyResult>,
  captureResult,
  synthesize,
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

function captureResult(raw: unknown, durationMs: number): CassetteResult {
  const r = raw as {
    stdout?: string
    stderr?: string
    exitCode?: number
    killed?: boolean
    aborted?: boolean
  }
  // tinyexec.stdout/stderr is always a string per its type contract; the [''] fallback
  // exists only for defensive narrowing on `unknown` raw input (e.g., a thrown error
  // shape that happens to lack stdout/stderr fields).
  //
  // tinyexec exposes only `killed: boolean`, not the actual signal name (SIGINT,
  // SIGKILL, etc.). We unconditionally record SIGTERM on kill; the real signal is
  // lost. Known limitation; tinyexec does not expose the signal name.
  const exitCode = r.exitCode ?? 0
  const killed = r.killed === true
  const aborted = r.aborted === true
  return {
    stdoutLines: typeof r.stdout === 'string' ? r.stdout.split('\n') : [''],
    stderrLines: typeof r.stderr === 'string' ? r.stderr.split('\n') : [''],
    allLines: null,
    exitCode,
    signal: killed ? 'SIGTERM' : null,
    durationMs,
    aborted,
    // Derived because tinyexec does not expose a `failed` boolean. Covers
    // the three known failure shapes (non-zero exit, signal kill, abort).
    // timedOut and isMaxBuffer are intentionally not stored: tinyexec
    // exposes neither; synth defaults each to false on replay.
    failed: exitCode !== 0 || killed || aborted,
  }
}

// Test-only export. See execa.ts for the same pattern.
export const _captureResultForTesting = captureResult

function synthesize(rec: Recording, options: Partial<Options>): TinyResult {
  const stdout = rec.result.stdoutLines.join('\n')
  const stderr = rec.result.stderrLines.join('\n')
  const killed = rec.result.signal !== null

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
