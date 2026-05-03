import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { _resetForTesting, clearActiveCassette, setActiveCassette } from '../../src/state.js'
import type { Recording, Result } from '../../src/types.js'
import { type RunnerHooks, runWrapped } from '../../src/wrapper.js'
import { restoreEnv } from '../helpers/env.js'
import { makeSession } from '../helpers/session.js'

const originalMode = process.env.SHELL_CASSETTE_MODE
const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION

type Opts = { input?: string; inputFile?: string }

function makeHooks(): {
  hooks: RunnerHooks<Opts, { stdout: string }>
  realCall: ReturnType<typeof vi.fn>
} {
  const realCall = vi.fn(
    async (
      _file: string,
      _args: readonly string[],
      _opts: Opts,
      _resolvedStdin: string | null | undefined,
    ) => ({ stdout: 'ok' }),
  )
  const hooks: RunnerHooks<Opts, { stdout: string }> = {
    validate: () => undefined,
    buildCall: async (file, args, opts) => ({
      command: file,
      args: [...args],
      cwd: null,
      env: {},
      stdin: opts.input ?? (opts.inputFile !== undefined ? '<file:bytes>' : null),
    }),
    realCall,
    captureResult: (raw): Result => {
      const r = raw as { stdout: string }
      return {
        stdoutLines: r.stdout.split('\n'),
        stderrLines: [''],
        allLines: null,
        exitCode: 0,
        signal: null,
        durationMs: 0,
        aborted: false,
      }
    },
    synthesize: (rec: Recording): { stdout: string } => ({
      stdout: rec.result.stdoutLines.join('\n'),
    }),
  }
  return { hooks, realCall }
}

describe('wrapper.realCall: resolvedStdin threading (#102)', () => {
  beforeEach(() => {
    _resetForTesting()
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    delete process.env.SHELL_CASSETTE_MODE
    delete process.env.CI
  })

  afterEach(() => {
    _resetForTesting()
    clearActiveCassette()
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
    restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  })

  test('passes resolvedStdin = call.stdin on record path with `input`', async () => {
    const session = makeSession({
      name: 't',
      path: '/tmp/test.json',
      loadedFile: null,
      matcher: null,
    })
    setActiveCassette(session)

    const { hooks, realCall } = makeHooks()
    await runWrapped('node', ['-v'], { input: 'literal-stdin' } satisfies Opts, hooks)

    expect(realCall).toHaveBeenCalledTimes(1)
    expect(realCall.mock.calls[0]?.[3]).toBe('literal-stdin')
  })

  test('passes resolvedStdin = call.stdin on record path with `inputFile` resolved by buildCall', async () => {
    const session = makeSession({
      name: 't',
      path: '/tmp/test.json',
      loadedFile: null,
      matcher: null,
    })
    setActiveCassette(session)

    const { hooks, realCall } = makeHooks()
    await runWrapped('node', ['-v'], { inputFile: '/some/path' } satisfies Opts, hooks)

    expect(realCall).toHaveBeenCalledTimes(1)
    // makeHooks's buildCall returns '<file:bytes>' as a stand-in for the
    // resolved stdin; the wrapper must thread that through to realCall.
    expect(realCall.mock.calls[0]?.[3]).toBe('<file:bytes>')
  })

  test('passes resolvedStdin = null on record path when neither input nor inputFile is set', async () => {
    const session = makeSession({
      name: 't',
      path: '/tmp/test.json',
      loadedFile: null,
      matcher: null,
    })
    setActiveCassette(session)

    const { hooks, realCall } = makeHooks()
    await runWrapped('node', ['-v'], {} satisfies Opts, hooks)

    expect(realCall).toHaveBeenCalledTimes(1)
    expect(realCall.mock.calls[0]?.[3]).toBeNull()
  })

  test('passes resolvedStdin = undefined on passthrough mode (buildCall skipped)', async () => {
    const session = makeSession({
      name: 't',
      path: '/tmp/test.json',
      loadedFile: null,
      matcher: null,
      scopeDefault: 'passthrough',
    })
    setActiveCassette(session)

    const { hooks, realCall } = makeHooks()
    await runWrapped('node', ['-v'], { input: 'irrelevant' } satisfies Opts, hooks)

    expect(realCall).toHaveBeenCalledTimes(1)
    expect(realCall.mock.calls[0]?.[3]).toBeUndefined()
  })

  test('passes resolvedStdin = undefined on no-active-session passthrough', async () => {
    // No setActiveCassette(): wrapper falls through to realCall after the
    // mode check (resolveMode defaults to passthrough when CI=false).
    const { hooks, realCall } = makeHooks()
    await runWrapped('node', ['-v'], { input: 'irrelevant' } satisfies Opts, hooks)

    expect(realCall).toHaveBeenCalledTimes(1)
    expect(realCall.mock.calls[0]?.[3]).toBeUndefined()
  })
})
