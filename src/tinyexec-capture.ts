import type { Result } from './types.js'

/**
 * Internal: maps a tinyexec raw result (with the OutputApi `aborted`/`killed`
 * snapshot the wrapper takes pre-await) to the cassette `Result` type. Lives
 * in a non-exported module so it stays out of the `shell-cassette/tinyexec`
 * public sub-path's `.d.ts` and IDE autocomplete. Tests import this module
 * directly via `src/tinyexec-capture.js`.
 *
 * tinyexec exposes only `killed: boolean` (not the actual signal name); we
 * unconditionally record `signal: 'SIGTERM'` when killed. The real signal
 * name is not recoverable from tinyexec's surface.
 */
export function captureResult(raw: unknown, durationMs: number): Result {
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
    killed,
    // Derived because tinyexec does not expose a `failed` boolean. Covers
    // the three known failure shapes (non-zero exit, signal kill, abort).
    // timedOut and isMaxBuffer are intentionally not stored: tinyexec
    // exposes neither; synth defaults each to false on replay.
    failed: exitCode !== 0 || killed || aborted,
  }
}
