import type { Options, Result as TinyResult } from 'tinyexec'
import { MissingPeerDependencyError, UnsupportedOptionError } from './errors.js'
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

function buildCall(file: string, args: readonly string[], options: Partial<Options>): Call {
  const nodeOptions = (options as { nodeOptions?: { cwd?: string; env?: NodeJS.ProcessEnv } })
    .nodeOptions
  return {
    command: file,
    args: [...args],
    cwd: nodeOptions?.cwd ?? null,
    env: (nodeOptions?.env as Record<string, string> | undefined) ?? {},
    stdin: null,
  }
}

function captureResult(raw: unknown): CassetteResult {
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
  // lost. Tracked in backlog: "preserve exact signal for tinyexec recording".
  return {
    stdoutLines: typeof r.stdout === 'string' ? r.stdout.split('\n') : [''],
    stderrLines: typeof r.stderr === 'string' ? r.stderr.split('\n') : [''],
    allLines: null,
    exitCode: r.exitCode ?? 0,
    signal: r.killed === true ? 'SIGTERM' : null,
    durationMs: 0,
    aborted: r.aborted === true,
  }
}

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
    process: null,
    pipe: () => {
      throw new UnsupportedOptionError(
        'tinyexec result.pipe() not supported on replay (no live subprocess). Tracked in backlog.',
      )
    },
    kill: () => {
      // no-op on replay; subprocess never spawned
    },
    [Symbol.asyncIterator]: () => {
      throw new UnsupportedOptionError(
        'tinyexec async iteration `for await (line of result)` not supported on replay. Tracked in backlog.',
      )
    },
  }

  if ((options as { throwOnError?: boolean }).throwOnError === true && rec.result.exitCode !== 0) {
    throw Object.assign(
      new Error(
        `Process exited with non-zero code: ${rec.result.exitCode} (command: ${rec.call.command})`,
      ),
      result,
    )
  }

  // The synthesized object lacks tinyexec's full structural shape (no `then`/`spawn`
  // fields from ExecProcess; `process` is null instead of ChildProcess | undefined).
  // Documented replay limit: code reading these fields synchronously before await,
  // or calling sync-only ProcessApi methods, must use real execution.
  return result as unknown as TinyResult
}
