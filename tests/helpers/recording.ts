import type { Recording, Result } from '../../src/types.js'

/**
 * Build a minimal Result with sensible defaults. Callers override only the
 * fields they care about. Defaults: exitCode 0, no signal, not aborted,
 * zero duration, empty line arrays, no allLines.
 */
export function makeResult(overrides: Partial<Result> = {}): Result {
  return {
    stdoutLines: [],
    stderrLines: [],
    allLines: null,
    exitCode: 0,
    signal: null,
    durationMs: 0,
    aborted: false,
    ...overrides,
  }
}

/**
 * Build a minimal Recording with sensible defaults. Pass `result` as a
 * Partial<Result> and it will be merged into makeResult() defaults.
 * Callers override only the fields they care about.
 */
export function makeRecording(
  overrides: Omit<Partial<Recording>, 'result'> & { result?: Partial<Result> } = {},
): Recording {
  const { result: resultOverrides, ...rest } = overrides
  return {
    call: {
      command: 'cmd',
      args: [],
      cwd: null,
      env: {},
      stdin: null,
    },
    result: makeResult(resultOverrides),
    redactions: [],
    suppressed: [],
    ...rest,
  }
}
