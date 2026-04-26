import type { Options, Result as TinyResult } from 'tinyexec'
import { x as realX } from 'tinyexec'
import { UnsupportedOptionError } from './errors.js'
import { validateOptions } from './options-tinyexec.js'
import type { Call, Result as CassetteResult, Recording } from './types.js'
import { type RunnerHooks, runWrapped } from './wrapper.js'

export type { Options, Result } from 'tinyexec'

export function x(file: string, args?: readonly string[], options?: Options): Promise<TinyResult> {
  return runWrapped(file, args ?? [], options ?? ({} as Options), tinyexecHooks)
}

const tinyexecHooks: RunnerHooks<Options, TinyResult> = {
  validate: (opts) => validateOptions(opts as Record<string, unknown> | undefined),
  buildCall,
  realCall: (file, args, options) =>
    realX(file, [...args], options) as unknown as Promise<TinyResult>,
  captureResult,
  synthesize,
}

function buildCall(file: string, args: readonly string[], options: Options): Call {
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
  return {
    stdoutLines: typeof r.stdout === 'string' ? r.stdout.split('\n') : [''],
    stderrLines: typeof r.stderr === 'string' ? r.stderr.split('\n') : [''],
    allLines: null,
    exitCode: r.exitCode ?? 0,
    signal: r.killed === true ? 'SIGTERM' : null,
    durationMs: 0,
  }
}

function synthesize(rec: Recording, options: Options): TinyResult {
  const stdout = rec.result.stdoutLines.join('\n')
  const stderr = rec.result.stderrLines.join('\n')
  const killed = rec.result.signal !== null

  const result = {
    stdout,
    stderr,
    exitCode: rec.result.exitCode,
    pid: -1,
    aborted: false,
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

  return result as unknown as TinyResult
}
