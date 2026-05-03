import type { Options } from 'execa'
import { setActiveCassette } from '../../src/state.js'
import type { Result } from '../../src/types.js'
import { makeRecording } from './recording.js'
import { makeSession } from './session.js'

/**
 * Build a one-recording session, set it active, force replay mode, and
 * call execa. Caller must mock 'execa' before importing the wrapper and
 * call this helper inside `useRecordingEnv` test scaffolding so env
 * teardown happens at afterEach.
 *
 * The third arg, `defaultOptions`, lets call-sites pre-set common
 * defaults (e.g. `{ reject: false }`) which the per-call `options`
 * spreads over.
 */
export async function replayExeca(
  options: Options,
  resultOverrides: Partial<Result>,
  defaultOptions: Options = {},
): Promise<unknown> {
  const { execa } = await import('../../src/execa.js')
  const recording = makeRecording({
    call: { command: 'cmd', args: [], cwd: null, env: {}, stdin: null },
    result: resultOverrides,
  })
  const session = makeSession({
    loadedFile: { version: 2, recordedBy: null, recordings: [recording] },
  })
  setActiveCassette(session)
  process.env.SHELL_CASSETTE_MODE = 'replay'
  return execa('cmd', [], { ...defaultOptions, ...options })
}
