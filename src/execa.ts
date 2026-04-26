import type { Options, ResultPromise } from 'execa'
import { execa as realExeca } from 'execa'
import { validateOptions } from './options.js'
import type { Call, Recording, Result } from './types.js'
import { type RunnerHooks, runWrapped } from './wrapper.js'

export function execa(
  file: string,
  args?: readonly string[],
  options?: Options,
): ResultPromise<Options> {
  return runWrapped(file, args ?? [], options ?? {}, execaHooks) as ResultPromise<Options>
}

const execaHooks: RunnerHooks<Options, unknown> = {
  validate: (opts) => validateOptions(opts as Record<string, unknown> | undefined),
  buildCall: (file, args, options) => buildCallExeca(file, args, options),
  realCall: (file, args, options) => realExeca(file, args, options) as unknown as Promise<unknown>,
  captureResult: (raw) => captureResultExeca(raw),
  synthesize: (rec, options) => synthesizeExeca(rec, options),
}

function buildCallExeca(file: string, args: readonly string[], options: Options): Call {
  return {
    command: file,
    args: [...args],
    cwd: (options.cwd as string | undefined) ?? null,
    env: (options.env as Record<string, string> | undefined) ?? {},
    stdin: null,
  }
}

function captureResultExeca(execaResult: unknown): Result {
  const r = execaResult as {
    stdout?: string | string[]
    stderr?: string | string[]
    all?: string | string[]
    exitCode?: number
    signal?: string | null
    durationMs?: number
  }
  return {
    stdoutLines: toLines(r.stdout),
    stderrLines: toLines(r.stderr),
    allLines: r.all === undefined ? null : toLines(r.all),
    exitCode: r.exitCode ?? 0,
    signal: r.signal ?? null,
    durationMs: r.durationMs ?? 0,
  }
}

function toLines(input: string | string[] | undefined): string[] {
  if (input === undefined) return ['']
  if (Array.isArray(input)) return [...input, '']
  return input.split('\n')
}

function synthesizeExeca(rec: Recording, options: Options): unknown {
  const stdout = rec.result.stdoutLines.join('\n')
  const stderr = rec.result.stderrLines.join('\n')
  const all =
    options.all === true ? (rec.result.allLines?.join('\n') ?? stdout + stderr) : undefined
  const result = {
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
    ...(all !== undefined && { all }),
  }

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
