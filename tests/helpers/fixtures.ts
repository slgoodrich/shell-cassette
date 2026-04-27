import type { Call, Recording } from '../../src/types.js'

/**
 * Build a minimal Call with sensible defaults. Callers override only the fields
 * they care about.
 */
export const callOf = (command: string, args: string[], extra: Partial<Call> = {}): Call => ({
  command,
  args,
  cwd: null,
  env: {},
  stdin: null,
  ...extra,
})

/**
 * Build a minimal Recording. The `stdout` shorthand sets stdoutLines to
 * [stdout, ''] and stderrLines to [''] (matches the typical single-line
 * capture shape). Pass `resultOverrides` for any other result field.
 */
export const recordingOf = (
  command: string,
  args: string[],
  stdout = '',
  resultOverrides: Partial<Recording['result']> = {},
): Recording => ({
  call: callOf(command, args),
  result: {
    stdoutLines: [stdout, ''],
    stderrLines: [''],
    allLines: null,
    exitCode: 0,
    signal: null,
    durationMs: 1,
    aborted: false,
    ...resultOverrides,
  },
  redactions: [],
})
