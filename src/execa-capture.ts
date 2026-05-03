import type { Result } from './types.js'

/**
 * Internal: maps an execa raw result (or thrown error shape) to the cassette
 * `Result` type. Lives in a non-exported module so it stays out of the
 * `shell-cassette/execa` public sub-path's `.d.ts` and IDE autocomplete.
 * Tests import this module directly via `src/execa-capture.js`.
 */
export function captureResult(raw: unknown, durationMs: number): Result {
  const r = raw as {
    stdout?: string | string[]
    stderr?: string | string[]
    all?: string | string[]
    exitCode?: number
    signal?: string | null
    isCanceled?: boolean
    killed?: boolean
    failed?: boolean
    timedOut?: boolean
    isMaxBuffer?: boolean
    isForcefullyTerminated?: boolean
    isGracefullyCanceled?: boolean
  }
  return {
    stdoutLines: toLines(r.stdout),
    stderrLines: toLines(r.stderr),
    allLines: r.all === undefined ? null : toLines(r.all),
    exitCode: r.exitCode ?? 0,
    signal: r.signal ?? null,
    durationMs,
    aborted: r.isCanceled === true,
    killed: r.killed === true,
    failed: r.failed === true,
    timedOut: r.timedOut === true,
    isMaxBuffer: r.isMaxBuffer === true,
    isForcefullyTerminated: r.isForcefullyTerminated === true,
    isGracefullyCanceled: r.isGracefullyCanceled === true,
  }
}

function toLines(input: string | string[] | undefined): string[] {
  if (input === undefined) return ['']
  if (Array.isArray(input)) return [...input, '']
  return input.split('\n')
}
